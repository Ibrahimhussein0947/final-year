import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { joinWindow } from '../modules/applications/interviews';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const HOUR = 3_600_000;
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Video ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let categoryId = '';
let skillId = '';
beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { categoryId } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function shortlisted() {
  const e = await signUp('EMPLOYER');
  const w = await signUp('WORKER');
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Mechanic ${tag()}`, description: `Workshop role for the video interview test. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
  });
  const jobId = create.body.job.id as string;
  expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
  const a = await prisma.application.findFirstOrThrow({ where: { jobId, worker: { userId: w.id } } });
  expect((await request(app).patch(`/api/v1/applications/${a.id}/status`).set(auth(e.token)).send({ status: 'SHORTLISTED' })).status).toBe(200);
  return { e, w, appId: a.id };
}
const book = (e: User, appId: string, at: Date, body: object) =>
  request(app).post(`/api/v1/applications/${appId}/interviews`).set(auth(e.token)).send({ scheduledAt: at.toISOString(), ...body });
const inHours = (h: number) => new Date(Date.now() + h * HOUR);

describe('video interview rooms', () => {
  it('tells the app whether the platform can make video rooms', async () => {
    const w = await signUp('WORKER');
    const r = await request(app).get('/api/v1/interviews/config').set(auth(w.token));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ videoRooms: true, videoHost: new URL(env.videoBaseUrl!).host });
  });

  it('makes a private room with an unguessable name, and nothing for a phone or in-person interview', async () => {
    const { e, appId } = await shortlisted();
    const made = await book(e, appId, inHours(48), { mode: 'VIDEO', createVideoRoom: true });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const iv = await prisma.interview.findFirstOrThrow({ where: { applicationId: appId } });
    expect(iv.locationOrLink).toMatch(new RegExp(`^${env.videoBaseUrl!.replace(/[.]/g, '\\.')}/et-[0-9a-f]{24}$`));
    expect(iv.videoRoom).toBe(iv.locationOrLink!.split('/').pop());

    // a second room is a different, random name
    const second = await shortlisted();
    await book(second.e, second.appId, inHours(48), { mode: 'VIDEO', createVideoRoom: true });
    expect((await prisma.interview.findFirstOrThrow({ where: { applicationId: second.appId } })).videoRoom).not.toBe(iv.videoRoom);

    const phone = await shortlisted();
    expect((await book(phone.e, phone.appId, inHours(48), { mode: 'PHONE', createVideoRoom: true })).status).toBe(400);
    expect((await book(phone.e, phone.appId, inHours(48), { mode: 'PHONE', locationOrLink: '0911' })).status).toBe(201);
    expect((await prisma.interview.findFirstOrThrow({ where: { applicationId: phone.appId } })).videoRoom).toBeNull();
  });

  it('keeps the employer\'s own link when they paste one', async () => {
    const { e, appId } = await shortlisted();
    expect((await book(e, appId, inHours(48), { mode: 'VIDEO', locationOrLink: 'https://meet.google.com/abc-defg-hij' })).status).toBe(201);
    const iv = await prisma.interview.findFirstOrThrow({ where: { applicationId: appId } });
    expect(iv).toMatchObject({ locationOrLink: 'https://meet.google.com/abc-defg-hij', videoRoom: null });
  });

  it('keeps the same room when the time is moved, and drops it when it stops being a video call', async () => {
    const { e, appId } = await shortlisted();
    await book(e, appId, inHours(48), { mode: 'VIDEO', createVideoRoom: true });
    const before = await prisma.interview.findFirstOrThrow({ where: { applicationId: appId } });
    const patch = (body: object) => request(app).patch(`/api/v1/applications/${appId}/interviews/${before.id}`).set(auth(e.token)).send(body);
    expect((await patch({ scheduledAt: inHours(72).toISOString(), mode: 'VIDEO', createVideoRoom: true })).status).toBe(200);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ videoRoom: before.videoRoom, locationOrLink: before.locationOrLink });
    expect((await patch({ scheduledAt: inHours(72).toISOString(), mode: 'IN_PERSON', locationOrLink: 'Adama office' })).status).toBe(200);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ videoRoom: null, locationOrLink: 'Adama office' });
  });
});

describe('joining a video call', () => {
  it('opens 15 minutes before the start for both sides, and closes two hours after', () => {
    const start = new Date('2027-01-05T08:00:00Z');
    const at = (iso: string) => joinWindow(start, new Date(iso));
    expect(at('2027-01-05T07:44:00Z').canJoinNow).toBe(false);
    expect(at('2027-01-05T07:45:00Z').canJoinNow).toBe(true);
    expect(at('2027-01-05T09:59:00Z').canJoinNow).toBe(true);
    expect(at('2027-01-05T10:01:00Z').canJoinNow).toBe(false);
  });

  it('gives the link only to the two people in the interview, and only inside the window', async () => {
    const { e, w, appId } = await shortlisted();
    const stranger = await signUp('WORKER');
    const otherEmployer = await signUp('EMPLOYER');
    expect((await book(e, appId, inHours(5), { mode: 'VIDEO', createVideoRoom: true })).status).toBe(201);
    const iv = await prisma.interview.findFirstOrThrow({ where: { applicationId: appId } });
    const join = (u: User) => request(app).get(`/api/v1/interviews/${iv.id}/join`).set(auth(u.token));

    const early = await join(w);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/can be joined from/);
    expect((await join(stranger)).status).toBe(404);
    expect((await join(otherEmployer)).status).toBe(404);
    expect((await request(app).get(`/api/v1/interviews/${iv.id}/join`)).status).toBe(401);

    // move the call to ten minutes from now: inside the window for both sides
    await prisma.interview.update({ where: { id: iv.id }, data: { scheduledAt: inHours(10 / 60) } });
    for (const u of [w, e]) {
      const ok = await join(u);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.url).toBe(iv.locationOrLink);
    }
    // long over
    await prisma.interview.update({ where: { id: iv.id }, data: { scheduledAt: inHours(-5) } });
    const over = await join(w);
    expect(over.status).toBe(409);
    expect(over.body.error.message).toMatch(/has ended/);
  });

  it('is not available for a phone interview, and the calendar list says when a video call can be joined', async () => {
    const { e, w, appId } = await shortlisted();
    expect((await book(e, appId, inHours(30), { mode: 'PHONE', locationOrLink: '0911' })).status).toBe(201);
    const iv = await prisma.interview.findFirstOrThrow({ where: { applicationId: appId } });
    expect((await request(app).get(`/api/v1/interviews/${iv.id}/join`).set(auth(w.token))).status).toBe(409);

    const v = await shortlisted();
    expect((await book(v.e, v.appId, inHours(30), { mode: 'VIDEO', createVideoRoom: true })).status).toBe(201);
    const list = await request(app).get('/api/v1/interviews/mine').set(auth(v.w.token));
    expect(list.body.items[0].video).toMatchObject({ platformRoom: true, canJoinNow: false });
    expect(list.body.items[0].video.opensAt).toBeTruthy();
    const phoneList = await request(app).get('/api/v1/interviews/mine').set(auth(w.token));
    expect(phoneList.body.items[0].video).toBeNull();
  });
});
