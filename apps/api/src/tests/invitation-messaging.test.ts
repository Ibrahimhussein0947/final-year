import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Chat ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
const profileId = async (u: User) => (await prisma.workerProfile.findFirstOrThrow({ where: { userId: u.id } })).id;

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

async function liveJob(e: User) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Mechanic ${tag()}`, description: `Workshop role for the invitation chat test. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

async function invited() {
  const e = await signUp('EMPLOYER');
  const w = await signUp('WORKER');
  const jobId = await liveJob(e);
  const inv = await request(app).post(`/api/v1/jobs/${jobId}/invitations`).set(auth(e.token)).send({ workerId: await profileId(w), message: 'Please apply.' });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  return { e, w, jobId, invitationId: inv.body.id as string };
}
const open = (u: User, invitationId: string) => request(app).post(`/api/v1/invitations/${invitationId}/conversation`).set(auth(u.token));
const send = (u: User, cid: string, body: string) => request(app).post(`/api/v1/conversations/${cid}/messages`).set(auth(u.token)).send({ body });

describe('talking before applying, started by the worker', () => {
  it('only the worker can start it; then both sides can write and see it labelled "before applying"', async () => {
    const { e, w, invitationId } = await invited();
    const early = await open(e, invitationId);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/has not replied/i);

    const outsider = await signUp('WORKER');
    expect((await open(outsider, invitationId)).status).toBe(404);
    expect((await open(await signUp('EMPLOYER'), invitationId)).status).toBe(404);

    const started = await open(w, invitationId);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const cid = started.body.conversationId as string;
    expect((await open(w, invitationId)).body.conversationId).toBe(cid); // idempotent
    expect((await open(e, invitationId)).body.conversationId).toBe(cid); // employer joins the one that exists

    expect((await send(w, cid, 'Is the job near Adama?')).status).toBe(201);
    expect((await send(e, cid, 'Yes, in the town centre.')).status).toBe(201);

    const mine = await request(app).get('/api/v1/conversations').set(auth(w.token));
    const row = mine.body.items.find((c: { id: string }) => c.id === cid);
    expect(row).toMatchObject({ beforeApplying: true, readOnly: false, applicationId: null });
    expect(row.with.role).toBe('EMPLOYER');
    expect(row.job.title).toMatch(/Mechanic/);
    expect(JSON.stringify(mine.body)).not.toMatch(/\+251/); // no phone numbers
    expect((await request(app).get('/api/v1/conversations').set(auth(e.token))).body.items.find((c: { id: string }) => c.id === cid).with.role).toBe('WORKER');

    // the invitation lists point to the conversation
    expect((await request(app).get('/api/v1/invitations/mine').set(auth(w.token))).body.items[0].conversationId).toBe(cid);
    const jobInv = await request(app).get(`/api/v1/jobs/${(await prisma.jobInvitation.findUniqueOrThrow({ where: { id: invitationId } })).jobId}/invitations`).set(auth(e.token));
    expect(jobInv.body.items[0].conversationId).toBe(cid);
  });

  it('carries on under the application when the worker applies', async () => {
    const { e, w, jobId, invitationId } = await invited();
    const cid = (await open(w, invitationId)).body.conversationId as string;
    await send(w, cid, 'One question first.');
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
    const application = await prisma.application.findFirstOrThrow({ where: { jobId } });

    const viaApplication = await request(app).post(`/api/v1/applications/${application.id}/conversation`).set(auth(e.token));
    expect(viaApplication.status).toBe(201);
    expect(viaApplication.body.conversationId).toBe(cid); // same thread, nothing lost
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: cid } })).applicationId).toBe(application.id);
    expect((await request(app).get(`/api/v1/conversations/${cid}/messages`).set(auth(e.token))).body.messages).toHaveLength(1);
    // opening from the invitation now leads to the same place
    expect((await open(e, invitationId)).body.conversationId).toBe(cid);
    expect(await prisma.conversation.count({ where: { OR: [{ invitationId }, { applicationId: application.id }] } })).toBe(1);
  });

  it('becomes read-only when the worker declines, and cannot be started for a declined invitation', async () => {
    const { w, invitationId } = await invited();
    const cid = (await open(w, invitationId)).body.conversationId as string;
    expect((await send(w, cid, 'Hello')).status).toBe(201);
    expect((await request(app).post(`/api/v1/invitations/${invitationId}/decline`).set(auth(w.token))).status).toBe(204);
    const blocked = await send(w, cid, 'Changed my mind');
    expect(blocked.status).toBe(409);
    expect((await request(app).get(`/api/v1/conversations/${cid}/messages`).set(auth(w.token))).body.readOnly).toBe(true);

    const second = await invited();
    await request(app).post(`/api/v1/invitations/${second.invitationId}/decline`).set(auth(second.w.token));
    expect((await open(second.w, second.invitationId)).status).toBe(409);
  });
});
