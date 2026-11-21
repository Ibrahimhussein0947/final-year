import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { MAX_INQUIRIES_PER_DAY, MAX_LISTINGS_PER_PROVIDER } from '../modules/marketplace/service';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
type User = { token: string; id: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  const phone = `+251${p.slice(1)}`;
  phones.push(phone);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Svc ${tag()}`, organizationType: 'HOUSEHOLD' } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone };
}

let categoryId = '';
let businessCategoryId = '';
let plumbingSkillId = '';
let officeSkillId = '';
let zoneId = '';
let adminId = '';
const adminToken = () => jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: adminId, expiresIn: '10m' });

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'construction' } })).id;
  businessCategoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'business' } })).id;
  plumbingSkillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'plumbing' } })).id;
  officeSkillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'office-admin' } })).id;
  zoneId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  adminId = (await prisma.user.create({ data: { phone: `+251${p.slice(1)}`, passwordHash: 'x', fullName: 'Svc Admin', role: 'ADMIN' } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  // reports are kept when their author is deleted, so they go first
  await prisma.report.deleteMany({ where: { OR: [{ reporter: { phone: { in: phones } } }, { resolvedBy: { phone: { in: phones } } }] } });
  await prisma.serviceListing.deleteMany({ where: { worker: { user: { phone: { in: phones } } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

const body = (over: Record<string, unknown> = {}) => ({
  title: `Plumbing repairs ${tag()}`,
  description: `I fix leaking pipes, taps and toilets, and install water tanks. ${randomUUID()} Fast, clean work with my own tools.`,
  categoryId, serviceMode: 'AT_CUSTOMER', payBasis: 'PER_PROJECT', priceMin: 300, priceMax: 2000, toolsIncluded: true,
  availability: 'Mon to Sat, 8:00 to 17:00', locationId: zoneId, skillIds: [plumbingSkillId], ...over,
});

async function liveListing(p: User, over: Record<string, unknown> = {}) {
  const c = await request(app).post('/api/v1/services').set(auth(p.token)).send(body(over));
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const id = c.body.listing.id as string;
  const pub = await request(app).post(`/api/v1/services/${id}/publish`).set(auth(p.token));
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return id;
}

describe('service listings', () => {
  it('lets a worker create a draft, keeps it private until it is published, and shows no exact place', async () => {
    const p = await signUp('WORKER');
    const c = await request(app).post('/api/v1/services').set(auth(p.token)).send(body());
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body.listing.id;
    expect(c.body.listing.status).toBe('DRAFT');
    expect((await request(app).get(`/api/v1/services/${id}`)).status).toBe(404); // a draft is not public
    expect((await request(app).get(`/api/v1/services/${id}`).set(auth(p.token))).status).toBe(200); // but its owner sees it
    expect((await request(app).post(`/api/v1/services/${id}/publish`).set(auth(p.token))).status).toBe(200);
    const pub = await request(app).get(`/api/v1/services/${id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.listing.provider.name).toContain('Test WORKER');
    expect(pub.body.listing.areaPath.map((l: { level: string }) => l.level)).not.toContain('KEBELE');
    expect(JSON.stringify(pub.body)).not.toContain(p.phone); // contact details are never on a public page
  });

  it('refuses text that demands who a person is, a listing with no skill, an area-less visit and a copy', async () => {
    const p = await signUp('WORKER');
    const bad = await request(app).post('/api/v1/services').set(auth(p.token)).send(body({ description: 'Only women aged 20 to 30 may call me for plumbing repairs and tap fitting, thank you.' }));
    expect(bad.status).toBe(400);
    const noSkill = await request(app).post('/api/v1/services').set(auth(p.token)).send(body({ skillIds: [] }));
    expect((await request(app).post(`/api/v1/services/${noSkill.body.listing.id}/publish`).set(auth(p.token))).body.error.details.skillIds).toBeTruthy();
    const noArea = await request(app).post('/api/v1/services').set(auth(p.token)).send(body({ locationId: null }));
    expect((await request(app).post(`/api/v1/services/${noArea.body.listing.id}/publish`).set(auth(p.token))).body.error.details.locationId).toBeTruthy();
    const remote = await request(app).post('/api/v1/services').set(auth(p.token)).send(body({ locationId: null, serviceMode: 'REMOTE' }));
    expect((await request(app).post(`/api/v1/services/${remote.body.listing.id}/publish`).set(auth(p.token))).status).toBe(200); // remote work needs no area
    const text = body();
    await liveListing(p, { title: text.title, description: text.description });
    const copy = await request(app).post('/api/v1/services').set(auth(p.token)).send(text);
    expect((await request(app).post(`/api/v1/services/${copy.body.listing.id}/publish`).set(auth(p.token))).body.error.details.description).toBeTruthy();
    expect((await request(app).post('/api/v1/services').set(auth(p.token)).send(body({ priceMin: 900, priceMax: 100 }))).status).toBe(400);
  });

  it('limits how many listings one provider can have, and only workers can create them', async () => {
    const p = await signUp('WORKER');
    for (let i = 0; i < MAX_LISTINGS_PER_PROVIDER; i++) expect((await request(app).post('/api/v1/services').set(auth(p.token)).send(body())).status).toBe(201);
    expect((await request(app).post('/api/v1/services').set(auth(p.token)).send(body())).status).toBe(409);
    const e = await signUp('EMPLOYER');
    expect((await request(app).post('/api/v1/services').set(auth(e.token)).send(body())).status).toBe(403);
    expect((await request(app).post('/api/v1/services').send(body())).status).toBe(401);
  });

  it('pauses and removes a listing, and a removed listing releases waiting customers', async () => {
    const p = await signUp('WORKER');
    const customer = await signUp('EMPLOYER');
    const id = await liveListing(p);
    const inq = await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(customer.token)).send({ message: 'Please fix my kitchen tap this week.' });
    expect(inq.status, JSON.stringify(inq.body)).toBe(201);
    expect((await request(app).post(`/api/v1/services/${id}/pause`).set(auth(p.token))).body.listing.status).toBe('PAUSED');
    expect((await request(app).get(`/api/v1/services/${id}`)).status).toBe(404);
    expect((await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(customer.token)).send({ message: 'Are you available tomorrow?' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/services/${id}`).set(auth(p.token))).status).toBe(204);
    const sent = await request(app).get('/api/v1/services/inquiries/sent').set(auth(customer.token));
    expect(sent.body.items[0].status).toBe('CANCELLED');
  });
});

describe('finding a service', () => {
  it('filters by kind of work, area, mode and price basis, and finds a listing by what a customer writes', async () => {
    const p = await signUp('WORKER');
    const word = tag();
    const id = await liveListing(p, { title: `Plumber ${word} repairs`, serviceMode: 'AT_PROVIDER' });
    const office = await liveListing(p, { title: `Typing ${word} service`, description: `Typing, printing and photocopy work for students and offices. ${randomUUID()} Open every day.`, skillIds: [officeSkillId], categoryId: businessCategoryId, payBasis: 'PER_PROJECT', serviceMode: 'REMOTE', locationId: null });
    const titles = async (qs: string) => ((await request(app).get(`/api/v1/services?q=${word}&${qs}`)).body.items.map((i: { id: string }) => i.id) as string[]).sort();
    expect(await titles('')).toEqual([id, office].sort());
    expect(await titles('mode=REMOTE')).toEqual([office]);
    expect(await titles('mode=AT_PROVIDER')).toEqual([id]);
    expect(await titles('category=construction')).toEqual([id]);
    expect(await titles('region=Oromia')).toEqual([id]);
    expect(await titles('region=Afar')).toEqual([]);
    expect(await titles('payBasis=HOURLY')).toEqual([]);
    expect((await request(app).get('/api/v1/services?mode=moon')).status).toBe(400);

    const ask = await request(app).post('/api/v1/services/ask').send({ text: 'I need plumbing work, there is a leaking pipe in my bathroom' });
    expect(ask.status, JSON.stringify(ask.body)).toBe(200);
    expect(ask.body.understood.skills.map((s: { name: string }) => s.name)).toContain('Plumbing');
    expect(ask.body.items.some((i: { id: string }) => i.id === id)).toBe(true);
    expect(ask.body.items.find((i: { id: string }) => i.id === id).matchedSkills).toBeGreaterThanOrEqual(1);
    expect((await request(app).post('/api/v1/services/ask').send({ text: 'short' })).status).toBe(400);
  });
});

describe('inquiries: the customer asks, the provider decides', () => {
  it('opens a chat and shares phone numbers only after the provider accepts', async () => {
    const provider = await signUp('WORKER');
    const customer = await signUp('EMPLOYER');
    const id = await liveListing(provider);
    const sent = await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(customer.token)).send({ message: 'My bathroom tap is leaking, can you come on Saturday?' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const inquiryId = sent.body.inquiry.id;

    const before = await request(app).get('/api/v1/services/inquiries/received').set(auth(provider.token));
    expect(before.body.items[0].status).toBe('SENT');
    expect(before.body.items[0].with.phone).toBeNull();
    expect(JSON.stringify(await request(app).get('/api/v1/services/inquiries/sent').set(auth(customer.token)).then((r) => r.body))).not.toContain(provider.phone);
    // the notification carries no message text
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: provider.id, type: 'service.inquiry' } });
    expect(JSON.stringify(note.payload)).not.toContain('leaking');
    // no chat exists yet, and a duplicate is refused
    expect((await request(app).get('/api/v1/conversations').set(auth(provider.token))).body.items.filter((c: { service: unknown }) => c.service)).toEqual([]);
    expect((await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(customer.token)).send({ message: 'Hello again, are you there?' })).status).toBe(409);

    const accept = await request(app).post(`/api/v1/services/inquiries/${inquiryId}/respond`).set(auth(provider.token)).send({ accept: true });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body.items[0].with.phone).toBe(customer.phone);
    const mine = await request(app).get('/api/v1/services/inquiries/sent').set(auth(customer.token));
    expect(mine.body.items[0].status).toBe('ACCEPTED');
    expect(mine.body.items[0].with.phone).toBe(provider.phone);
    expect(await prisma.notification.count({ where: { userId: customer.id, type: 'service.inquiry_accepted' } })).toBe(1);

    const convs = await request(app).get('/api/v1/conversations').set(auth(customer.token));
    const chat = convs.body.items.find((c: { service: { id: string } | null }) => c.service?.id === id);
    expect(chat.with.role).toBe('PROVIDER');
    expect(chat.with.name).toContain('Test WORKER');
    const msg = await request(app).post(`/api/v1/conversations/${chat.id}/messages`).set(auth(customer.token)).send({ body: 'Saturday morning works for me.' });
    expect(msg.status, JSON.stringify(msg.body)).toBe(201);
    const theirs = await request(app).get('/api/v1/conversations').set(auth(provider.token));
    expect(theirs.body.items.find((c: { id: string }) => c.id === chat.id).with.role).toBe('CUSTOMER');
    expect((await request(app).get(`/api/v1/conversations/${chat.id}/messages`).set(auth(provider.token))).body.messages[0].body).toBe('Saturday morning works for me.');
    // answering twice is refused
    expect((await request(app).post(`/api/v1/services/inquiries/${inquiryId}/respond`).set(auth(provider.token)).send({ accept: false })).status).toBe(409);
  });

  it('lets the provider decline or block, never reveals a block, and lets a customer cancel', async () => {
    const provider = await signUp('WORKER');
    const customer = await signUp('WORKER');
    const id = await liveListing(provider);
    const send = (t: string, m: string) => request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(t)).send({ message: m });
    const first = await send(customer.token, 'Can you fix a leaking pipe tomorrow?');
    expect((await request(app).post(`/api/v1/services/inquiries/${first.body.inquiry.id}/cancel`).set(auth(customer.token))).body.items[0].status).toBe('CANCELLED');
    expect((await request(app).post(`/api/v1/services/inquiries/${first.body.inquiry.id}/cancel`).set(auth(customer.token))).status).toBe(409);

    const second = await send(customer.token, 'Second try: a pipe under my sink leaks.');
    expect((await request(app).post(`/api/v1/services/inquiries/${second.body.inquiry.id}/respond`).set(auth(provider.token)).send({ accept: false, block: true })).status).toBe(200);
    const declined = await prisma.notification.findFirstOrThrow({ where: { userId: customer.id, type: 'service.inquiry_declined' } });
    expect(JSON.stringify(declined.payload)).not.toMatch(/block/i);
    const blocked = await send(customer.token, 'Third try: please call me back.');
    expect(blocked.status).toBe(403);
    // others are not affected
    const other = await signUp('EMPLOYER');
    expect((await send(other.token, 'Are you free on Monday morning?')).status).toBe(201);
  });

  it('keeps people out of other people\'s inquiries, limits inquiries per day and refuses your own listing', async () => {
    const provider = await signUp('WORKER');
    const customer = await signUp('EMPLOYER');
    const stranger = await signUp('WORKER');
    const id = await liveListing(provider);
    const inq = await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(customer.token)).send({ message: 'I need a water tank installed.' });
    expect((await request(app).post(`/api/v1/services/inquiries/${inq.body.inquiry.id}/respond`).set(auth(stranger.token)).send({ accept: true })).status).toBe(404);
    expect((await request(app).post(`/api/v1/services/inquiries/${inq.body.inquiry.id}/cancel`).set(auth(stranger.token))).status).toBe(409);
    expect((await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(provider.token)).send({ message: 'Asking myself for help here.' })).status).toBe(400);
    expect((await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(customer.token)).send({ message: 'short' })).status).toBe(400);
    expect((await request(app).post(`/api/v1/services/${id}/inquiries`).send({ message: 'Not signed in at all.' })).status).toBe(401);
    expect((await request(app).post(`/api/v1/services/${id}/inquiries`).set(auth(adminToken())).send({ message: 'An administrator asking.' })).status).toBe(403);

    const busy = await signUp('EMPLOYER');
    for (let i = 0; i < MAX_INQUIRIES_PER_DAY; i++) {
      const other = await liveListing(await signUp('WORKER'));
      expect((await request(app).post(`/api/v1/services/${other}/inquiries`).set(auth(busy.token)).send({ message: `Request number ${i + 1} for a plumber.` })).status).toBe(201);
    }
    const extra = await liveListing(await signUp('WORKER'));
    expect((await request(app).post(`/api/v1/services/${extra}/inquiries`).set(auth(busy.token)).send({ message: 'One request too many today.' })).status).toBe(429);
  });
});

describe('reporting a service', () => {
  it('lets anyone report a listing, and lets an administrator take it down with the provider told', async () => {
    const provider = await signUp('WORKER');
    const reporter = await signUp('EMPLOYER');
    const id = await liveListing(provider);
    expect((await request(app).post('/api/v1/reports').set(auth(provider.token)).send({ targetType: 'SERVICE', targetId: id, reason: 'SCAM' })).status).toBe(400); // your own listing
    const rep = await request(app).post('/api/v1/reports').set(auth(reporter.token)).send({ targetType: 'SERVICE', targetId: id, reason: 'SCAM', details: 'Asks for money first' });
    expect(rep.status, JSON.stringify(rep.body)).toBe(201);
    const q = await request(app).get('/api/v1/admin/moderation/reports').set(auth(adminToken()));
    const row = q.body.items.find((r: { id: string }) => r.id === rep.body.id);
    expect(row.target.label).toContain('service by');
    const noNote = await request(app).post(`/api/v1/admin/moderation/reports/${rep.body.id}/resolve`).set(auth(adminToken())).send({ action: 'REMOVE_SERVICE' });
    expect(noNote.status).toBe(400);
    const done = await request(app).post(`/api/v1/admin/moderation/reports/${rep.body.id}/resolve`).set(auth(adminToken())).send({ action: 'REMOVE_SERVICE', note: 'Asked customers to pay first' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await request(app).get(`/api/v1/services/${id}`)).status).toBe(404);
    expect(await prisma.notification.count({ where: { userId: provider.id, type: 'service.removed' } })).toBe(1);
  });
});
