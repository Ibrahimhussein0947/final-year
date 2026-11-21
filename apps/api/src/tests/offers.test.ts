import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { runOfferChecks, today } from '../modules/offers/service';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const dayFrom = (d: number) => new Date(today().getTime() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Offers ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let transportId = ''; let heavyId = ''; let adamaId = '';
beforeAll(async () => {
  transportId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  heavyId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG Offers' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG Offers' } } });
  await prisma.$disconnect();
});

/** An employer, a worker, and the worker's application at the given status. */
async function setup(finalStatus: 'PENDING' | 'ACCEPTED' = 'ACCEPTED') {
  const e = await signUp('EMPLOYER');
  const w = await signUp('WORKER');
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: transportId, headline: 'Driver', yearsExperience: 6, availability: 'IMMEDIATELY', locationId: adamaId });
  await request(app).put(`/api/v1/workers/me/skills/${heavyId}`).set(auth(w.token)).send({ proficiency: 4 });
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Driver ${tag()}`, description: `We need a heavy truck driver for regional deliveries. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId: transportId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId: heavyId, importance: 'REQUIRED' }],
  });
  expect(create.status).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  const applied = await request(app).post(`/api/v1/jobs/${create.body.job.id}/apply`).set(auth(w.token)).send({});
  expect(applied.status).toBe(201);
  const appId = applied.body.applicationId as string;
  if (finalStatus === 'ACCEPTED') {
    for (const status of ['SHORTLISTED', 'ACCEPTED']) expect((await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status })).status).toBe(200);
  }
  return { e, w, appId };
}
const offer = (e: User, appId: string, body: object) => request(app).post(`/api/v1/applications/${appId}/offer`).set(auth(e.token)).send(body);
const notes = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type } });

describe('writing an offer', () => {
  it('needs an accepted application, a real future start date, and belongs to the employer who owns the job', async () => {
    const pending = await setup('PENDING');
    expect((await offer(pending.e, pending.appId, { startDate: dayFrom(10) })).status).toBe(409);

    const { e, w, appId } = await setup();
    expect((await offer(e, appId, { startDate: dayFrom(-1) })).status).toBe(400); // past
    expect((await offer(e, appId, { startDate: '2026-02-31' })).status).toBe(400); // no such day
    expect((await offer(e, appId, { startDate: dayFrom(5), respondBy: dayFrom(9) })).status).toBe(400); // answer date after the start
    expect((await offer(e, appId, { startDate: dayFrom(5), salary: -5 })).status).toBe(400);
    expect((await offer(e, appId, { startDate: dayFrom(5), note: 'x'.repeat(301) })).status).toBe(400);
    expect((await offer(pending.e, appId, { startDate: dayFrom(5) })).status).toBe(404); // someone else's application
    expect((await offer(w, appId, { startDate: dayFrom(5) })).status).toBe(403); // a worker cannot write one

    const ok = await offer(e, appId, { startDate: dayFrom(10), salary: 12000, note: 'Bring your licence on the first day.' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.offer).toMatchObject({ status: 'OFFERED', salary: 12000, startDate: dayFrom(10), startsInDays: 10 });
    expect(ok.body.offer.respondBy <= ok.body.offer.startDate).toBe(true);
    expect((await notes(w.id, 'offer.made')).length).toBe(1);
    expect((await offer(e, appId, { startDate: dayFrom(11) })).status).toBe(409); // one already waiting
  });
});

describe('answering an offer', () => {
  it('lets only that worker answer, once, and tells the employer', async () => {
    const { e, w, appId } = await setup();
    const id = (await offer(e, appId, { startDate: dayFrom(10) })).body.offer.id as string;
    const other = await signUp('WORKER');
    expect((await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(other.token)).send({ accept: true })).status).toBe(404);
    expect((await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(e.token)).send({ accept: true })).status).toBe(403);
    expect((await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(w.token)).send({})).status).toBe(400);

    const mine = await request(app).get('/api/v1/offers/mine').set(auth(w.token));
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].note).toBeNull();

    const r = await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(w.token)).send({ accept: true });
    expect(r.body.offer.status).toBe('ACCEPTED');
    expect((await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(w.token)).send({ accept: false })).status).toBe(409);
    const told = await notes(e.id, 'offer.responded');
    expect(told).toHaveLength(1);
    expect((told[0].payload as { accepted: boolean }).accepted).toBe(true);
    expect((await request(app).get('/api/v1/offers/sent').set(auth(e.token))).body.items[0].status).toBe('ACCEPTED');
  });

  it('allows a new offer after a decline, but not over an accepted one', async () => {
    const { e, w, appId } = await setup();
    const first = (await offer(e, appId, { startDate: dayFrom(10) })).body.offer.id as string;
    expect((await request(app).post(`/api/v1/offers/${first}/respond`).set(auth(w.token)).send({ accept: false })).body.offer.status).toBe('DECLINED');
    const again = await offer(e, appId, { startDate: dayFrom(12), salary: 15000 });
    expect(again.status).toBe(201);
    expect(again.body.offer.id).toBe(first); // the same record, reissued
    expect(again.body.offer.status).toBe('OFFERED');
    await request(app).post(`/api/v1/offers/${first}/respond`).set(auth(w.token)).send({ accept: true });
    expect((await offer(e, appId, { startDate: dayFrom(14) })).status).toBe(409);
  });

  it('expires when nobody answers by the date', async () => {
    const { e, w, appId } = await setup();
    const id = (await offer(e, appId, { startDate: dayFrom(5), respondBy: dayFrom(2) })).body.offer.id as string;
    await prisma.jobOffer.update({ where: { id }, data: { respondBy: new Date(`${dayFrom(-1)}T00:00:00.000Z`), startDate: new Date(`${dayFrom(3)}T00:00:00.000Z`) } });
    const late = await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(w.token)).send({ accept: true });
    expect(late.status).toBe(409);
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRED');
    expect((await notes(e.id, 'offer.expired')).length).toBe(1);
    expect((await offer(e, appId, { startDate: dayFrom(6) })).status).toBe(201); // can be sent again
  });
});

describe('starting work', () => {
  it('can be confirmed from the start date by either side, and not before', async () => {
    const { e, w, appId } = await setup();
    const id = (await offer(e, appId, { startDate: dayFrom(3) })).body.offer.id as string;
    expect((await request(app).post(`/api/v1/offers/${id}/started`).set(auth(w.token))).status).toBe(409); // not accepted yet
    await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(w.token)).send({ accept: true });
    expect((await request(app).post(`/api/v1/offers/${id}/started`).set(auth(w.token))).status).toBe(409); // too early
    await prisma.jobOffer.update({ where: { id }, data: { startDate: new Date(`${dayFrom(0)}T00:00:00.000Z`) } });
    const s = await request(app).post(`/api/v1/offers/${id}/started`).set(auth(e.token));
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.offer.status).toBe('STARTED');
    expect((await notes(w.id, 'offer.started')).length).toBe(1);
    expect((await request(app).post(`/api/v1/offers/${id}/started`).set(auth(w.token))).body.offer.status).toBe('STARTED'); // idempotent
    expect((await request(app).post(`/api/v1/offers/${id}/withdraw`).set(auth(e.token))).status).toBe(409); // too late to take back
  });

  it('can be taken back by the employer before it starts', async () => {
    const { e, w, appId } = await setup();
    const id = (await offer(e, appId, { startDate: dayFrom(8) })).body.offer.id as string;
    await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(w.token)).send({ accept: true });
    expect((await request(app).post(`/api/v1/offers/${id}/withdraw`).set(auth(w.token))).status).toBe(403);
    expect((await request(app).post(`/api/v1/offers/${id}/withdraw`).set(auth(e.token))).body.offer.status).toBe('WITHDRAWN');
    const told = await notes(w.id, 'offer.withdrawn');
    expect((told[0].payload as { wasAccepted: boolean }).wasAccepted).toBe(true);
  });
});

describe('reminders', () => {
  it('remind both sides the day before the start, and the worker the day before an answer is due, each only once', async () => {
    const { e, w, appId } = await setup();
    const id = (await offer(e, appId, { startDate: dayFrom(1), respondBy: dayFrom(1) })).body.offer.id as string;

    const first = await runOfferChecks();
    expect(first.expiryReminders).toBeGreaterThanOrEqual(1);
    expect((await notes(w.id, 'offer.reminder')).map((n) => (n.payload as { kind: string }).kind)).toEqual(['answer']);
    expect((await runOfferChecks()).expiryReminders).toBe(0); // not twice

    await request(app).post(`/api/v1/offers/${id}/respond`).set(auth(w.token)).send({ accept: true });
    expect((await runOfferChecks()).startReminders).toBeGreaterThanOrEqual(1);
    expect((await notes(w.id, 'offer.reminder')).length).toBe(2);
    expect((await notes(e.id, 'offer.reminder')).length).toBe(1);
    expect((await runOfferChecks()).startReminders).toBe(0); // not twice
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id } })).startRemindedAt).not.toBeNull();
  });

  it('expires unanswered offers on the sweep', async () => {
    const { e, appId } = await setup();
    const id = (await offer(e, appId, { startDate: dayFrom(2), respondBy: dayFrom(1) })).body.offer.id as string;
    const out = await runOfferChecks(new Date(Date.now() + 4 * 86_400_000));
    expect(out.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRED');
  });
});
