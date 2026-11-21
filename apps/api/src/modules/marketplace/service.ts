import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../../lib/errors';
import { detectDiscrimination, discriminationMessage } from '../criteria/discrimination';
import { jobFingerprint, similarity } from '../jobs/similarity';
import { analyzeJobText } from '../analysis/service';
import { notify } from '../notifications/service';
import { trustFor, type Trust } from '../workers/trust';
import { workerIdFor } from '../workers/service';
import type { z } from 'zod';
import type { ListingQuery, listingCreateSchema, listingUpdateSchema } from './schema';

type ListingCreate = z.infer<typeof listingCreateSchema>;
type ListingUpdate = z.infer<typeof listingUpdateSchema>;

/** Rules that keep the marketplace small enough to trust. */
export const MAX_LISTINGS_PER_PROVIDER = 5;
export const MAX_INQUIRIES_PER_DAY = 5;
const DUPLICATE_SIMILARITY = 0.9;

const loc = { select: { id: true, level: true, nameEn: true, parent: { select: { id: true, level: true, nameEn: true, parent: { select: { id: true, level: true, nameEn: true, parent: { select: { id: true, level: true, nameEn: true } } } } } } } } as const;

const listingInclude = {
  category: { select: { id: true, slug: true, nameEn: true } },
  location: loc,
  skills: { select: { skillId: true, skill: { select: { nameEn: true } } } },
  worker: { select: { id: true, userId: true, photoFileId: true, user: { select: { fullName: true } } } },
} satisfies Prisma.ServiceListingInclude;
type ListingRow = Prisma.ServiceListingGetPayload<{ include: typeof listingInclude }>;

/** The area served, from region down to woreda. A kebele is never shown, so a provider's street cannot be worked out. */
function areaPath(l: unknown): { id: string; level: string; name: string }[] {
  const out: { id: string; level: string; name: string }[] = [];
  for (let cur = l as { id: string; level: string; nameEn: string; parent?: unknown } | null | undefined; cur; cur = cur.parent as typeof cur) {
    if (cur.level !== 'KEBELE') out.unshift({ id: cur.id, level: cur.level, name: cur.nameEn });
  }
  return out;
}

function toItem(r: ListingRow, trust?: Trust) {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    category: { id: r.category.id, slug: r.category.slug, name: r.category.nameEn },
    serviceMode: r.serviceMode,
    payBasis: r.payBasis,
    priceMin: r.priceMin,
    priceMax: r.priceMax,
    currency: r.currency,
    toolsIncluded: r.toolsIncluded,
    availability: r.availability,
    areaPath: areaPath(r.location),
    skills: r.skills.slice(0, 6).map((s) => s.skill.nameEn),
    publishedAt: r.publishedAt,
    provider: {
      name: r.worker.user.fullName,
      photoUrl: r.worker.photoFileId ? `/api/v1/files/${r.worker.photoFileId}` : null,
      trust: trust ?? null,
    },
  };
}

function toDetail(r: ListingRow, trust: Trust | undefined, isOwner: boolean) {
  return {
    ...toItem(r, trust),
    description: r.description,
    allSkills: r.skills.map((s) => ({ skillId: s.skillId, name: s.skill.nameEn })),
    ...(isOwner ? { categoryId: r.categoryId, locationId: r.locationId } : {}),
    isOwner,
  };
}

async function withTrust(rows: ListingRow[]) {
  const trust = await trustFor(rows.map((r) => r.workerId));
  return rows.map((r) => toItem(r, trust.get(r.workerId)));
}

/** Titles and descriptions describe the work. They may not demand a gender, age, religion, ethnicity or marital status. */
function assertTextIsJobRelated(input: { title?: string; description?: string; availability?: string | null }) {
  const findings = detectDiscrimination(input.title, input.description, input.availability);
  if (findings.length) throw badRequest('This listing contains wording that is not allowed', { description: [discriminationMessage(findings)] });
}

async function validateRefs(input: { categoryId?: string; locationId?: string | null; skillIds?: string[] }) {
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw badRequest('Unknown category', { categoryId: ['Choose a valid category'] });
  if (input.locationId && !(await prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true } }))) throw badRequest('Unknown location', { locationId: ['Choose a valid location'] });
  if (input.skillIds?.length) {
    const found = await prisma.skill.count({ where: { id: { in: input.skillIds }, isActive: true } });
    if (found !== input.skillIds.length) throw badRequest('Unknown skill', { skillIds: ['One or more skills do not exist'] });
  }
}

// ───────── The provider's own listings ─────────

export async function myListings(userId: string) {
  const workerId = await workerIdFor(userId);
  const rows = await prisma.serviceListing.findMany({ where: { workerId, status: { not: 'REMOVED' } }, include: listingInclude, orderBy: { updatedAt: 'desc' } });
  const pending = await prisma.serviceInquiry.groupBy({ by: ['serviceId'], where: { serviceId: { in: rows.map((r) => r.id) }, status: 'SENT' }, _count: true });
  const waiting = new Map(pending.map((p) => [p.serviceId, p._count]));
  return (await withTrust(rows)).map((i) => ({ ...i, waitingInquiries: waiting.get(i.id) ?? 0 }));
}

export async function createListing(userId: string, input: ListingCreate) {
  const workerId = await workerIdFor(userId);
  assertTextIsJobRelated(input);
  await validateRefs(input);
  const open = await prisma.serviceListing.count({ where: { workerId, status: { not: 'REMOVED' } } });
  if (open >= MAX_LISTINGS_PER_PROVIDER) throw conflict(`You can have at most ${MAX_LISTINGS_PER_PROVIDER} listings. Remove one to add another.`);
  const { skillIds, ...data } = input;
  const row = await prisma.serviceListing.create({
    data: { ...data, workerId, status: 'DRAFT', descriptionHash: jobFingerprint(input.title, input.description), skills: { create: skillIds.map((skillId) => ({ skillId })) } },
  });
  return row.id;
}

async function ownedListing(userId: string, id: string) {
  const workerId = await workerIdFor(userId);
  const row = await prisma.serviceListing.findFirst({ where: { id, workerId, status: { not: 'REMOVED' } } });
  if (!row) throw notFound('Listing not found');
  return row;
}

export async function updateListing(userId: string, id: string, input: ListingUpdate) {
  const row = await ownedListing(userId, id);
  assertTextIsJobRelated(input);
  await validateRefs(input);
  const { skillIds, ...data } = input;
  const next: Prisma.ServiceListingUncheckedUpdateInput = { ...data };
  if (data.title !== undefined || data.description !== undefined) next.descriptionHash = jobFingerprint(data.title ?? row.title, data.description ?? row.description);
  await prisma.$transaction(async (tx) => {
    await tx.serviceListing.update({ where: { id }, data: next });
    if (skillIds) {
      await tx.serviceSkill.deleteMany({ where: { serviceId: id } });
      await tx.serviceSkill.createMany({ data: skillIds.map((skillId) => ({ serviceId: id, skillId })) });
    }
  });
}

/** What must be true before a listing can be shown to customers. */
async function publishProblems(id: string, workerId: string) {
  const r = await prisma.serviceListing.findUniqueOrThrow({ where: { id }, include: { skills: { select: { skillId: true } } } });
  const problems: Record<string, string[]> = {};
  if (r.skills.length === 0) problems.skillIds = ['Add at least one skill, so customers can see what you do.'];
  if (r.serviceMode !== 'REMOTE' && !r.locationId) problems.locationId = ['Choose the area you serve. It is required unless the service is done remotely.'];
  const others = await prisma.serviceListing.findMany({ where: { workerId, id: { not: id }, status: { not: 'REMOVED' } }, select: { title: true, description: true } });
  if (others.some((o) => similarity(`${o.title} ${o.description}`, `${r.title} ${r.description}`) >= DUPLICATE_SIMILARITY)) {
    problems.description = ['You already have a listing that says almost the same. Change this one or remove the other.'];
  }
  return problems;
}

export async function publishListing(userId: string, id: string) {
  const row = await ownedListing(userId, id);
  if (row.status === 'ACTIVE') return;
  const problems = await publishProblems(id, row.workerId);
  if (Object.keys(problems).length) throw badRequest('This listing is not ready to publish', problems);
  await prisma.serviceListing.update({ where: { id }, data: { status: 'ACTIVE', publishedAt: row.publishedAt ?? new Date() } });
}

export async function pauseListing(userId: string, id: string) {
  const row = await ownedListing(userId, id);
  if (row.status !== 'ACTIVE') throw conflict('Only a published listing can be paused');
  await prisma.serviceListing.update({ where: { id }, data: { status: 'PAUSED' } });
}

export async function removeListing(userId: string, id: string) {
  await ownedListing(userId, id);
  await prisma.$transaction([
    prisma.serviceListing.update({ where: { id }, data: { status: 'REMOVED' } }),
    // waiting customers are told it is no longer available, instead of waiting for an answer that will not come
    prisma.serviceInquiry.updateMany({ where: { serviceId: id, status: 'SENT' }, data: { status: 'CANCELLED', respondedAt: new Date() } }),
  ]);
}

// ───────── Discovery ─────────

async function placeFilter(q: { region?: string; locationId?: string }): Promise<Prisma.ServiceListingWhereInput | null | 'none'> {
  let placeId = q.locationId;
  if (!placeId && q.region) {
    placeId = (await prisma.location.findFirst({ where: { level: 'REGION', nameEn: { equals: q.region, mode: 'insensitive' } }, select: { id: true } }))?.id;
    if (!placeId) return 'none';
  }
  if (!placeId) return null;
  return {
    OR: [
      { locationId: placeId },
      { location: { parentId: placeId } },
      { location: { parent: { parentId: placeId } } },
      { location: { parent: { parent: { parentId: placeId } } } },
    ],
  };
}

export async function searchListings(q: ListingQuery) {
  const and: Prisma.ServiceListingWhereInput[] = [{ status: 'ACTIVE' }];
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
        { skills: { some: { skill: { OR: [{ nameEn: { contains: q.q, mode: 'insensitive' } }, { aliases: { has: q.q.toLowerCase() } }] } } } },
      ],
    });
  }
  if (q.category) and.push({ category: { slug: q.category } });
  if (q.mode) and.push({ serviceMode: q.mode });
  if (q.payBasis) and.push({ payBasis: q.payBasis });
  if (q.verifiedOnly === 'true') {
    const approved = await prisma.verificationRequest.findMany({ where: { kind: 'IDENTITY', targetType: 'NATIONAL_ID', status: 'APPROVED' }, select: { targetId: true } });
    and.push({ workerId: { in: approved.map((a) => a.targetId).filter((x): x is string => !!x) } });
  }
  const place = await placeFilter(q);
  if (place === 'none') return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
  if (place) and.push(place);
  const where: Prisma.ServiceListingWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.serviceListing.count({ where }),
    prisma.serviceListing.findMany({ where, include: listingInclude, orderBy: { publishedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  let items = await withTrust(rows);
  if (q.sort === 'trusted') items = [...items].sort((a, b) => (b.provider.trust?.level ?? 0) - (a.provider.trust?.level ?? 0));
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/**
 * "Tell us what you need": the text is read with the same rule-based analyzer that reads job ads, which suggests a kind of
 * work and skills, and listings are ranked by how many of those skills they offer. This is keyword and taxonomy matching,
 * not a language model; the response says what was understood so the customer can see why a listing ranked where it did.
 */
export async function askForService(text: string) {
  const analysis = await analyzeJobText({ description: text });
  const skillIds = analysis.skills.map((s) => s.skillId);
  const categoryId = analysis.category?.value.id ?? null;
  const candidates = skillIds.length || categoryId
    ? await prisma.serviceListing.findMany({
        where: { status: 'ACTIVE', OR: [...(skillIds.length ? [{ skills: { some: { skillId: { in: skillIds } } } }] : []), ...(categoryId ? [{ categoryId }] : [])] },
        include: listingInclude,
        orderBy: { publishedAt: 'desc' },
        take: 100,
      })
    : [];
  const trust = await trustFor(candidates.map((c) => c.workerId));
  const wanted = new Set(skillIds);
  const ranked = candidates
    .map((c) => {
      const overlap = c.skills.filter((s) => wanted.has(s.skillId)).length;
      const score = overlap * 3 + (categoryId && c.categoryId === categoryId ? 2 : 0) + (trust.get(c.workerId)?.level ?? 0) * 0.5;
      return { c, overlap, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  return {
    understood: {
      category: analysis.category ? { id: analysis.category.value.id, name: analysis.category.value.name } : null,
      skills: analysis.skills.map((s) => ({ skillId: s.skillId, name: s.name })),
    },
    items: ranked.map(({ c, overlap }) => ({ ...toItem(c, trust.get(c.workerId)), matchedSkills: overlap })),
  };
}

export async function getListing(id: string, viewerId: string | null) {
  const row = await prisma.serviceListing.findUnique({ where: { id }, include: listingInclude });
  if (!row || row.status === 'REMOVED') throw notFound('Listing not found');
  const isOwner = !!viewerId && row.worker.userId === viewerId;
  if (row.status !== 'ACTIVE' && !isOwner) throw notFound('Listing not found');
  const trust = (await trustFor([row.workerId])).get(row.workerId);
  return toDetail(row, trust, isOwner);
}

// ───────── Inquiries: a customer asks, the provider decides ─────────

const DAY = 86_400_000;

export async function sendInquiry(customerId: string, serviceId: string, input: { message: string; preferredDate?: string }) {
  const listing = await prisma.serviceListing.findUnique({ where: { id: serviceId }, include: { worker: { select: { userId: true } } } });
  if (!listing || listing.status !== 'ACTIVE') throw notFound('This service is not available');
  if (listing.worker.userId === customerId) throw badRequest('This is your own listing');
  if (await prisma.serviceBlock.findUnique({ where: { providerUserId_customerId: { providerUserId: listing.worker.userId, customerId } }, select: { customerId: true } })) {
    throw forbidden('This provider is not taking inquiries from you');
  }
  if (await prisma.serviceInquiry.findFirst({ where: { serviceId, customerId, status: 'SENT' }, select: { id: true } })) {
    throw conflict('You already asked this provider. Wait for their answer.');
  }
  const recent = await prisma.serviceInquiry.count({ where: { customerId, createdAt: { gte: new Date(Date.now() - DAY) } } });
  if (recent >= MAX_INQUIRIES_PER_DAY) throw tooMany(`You can send ${MAX_INQUIRIES_PER_DAY} inquiries a day. Try again tomorrow.`);
  const row = await prisma.serviceInquiry.create({
    data: { serviceId, customerId, message: input.message, preferredDate: input.preferredDate ? new Date(`${input.preferredDate}T00:00:00+03:00`) : null },
  });
  // The notification never carries the message text: it is written by another user.
  await notify(listing.worker.userId, 'service.inquiry', { inquiryId: row.id, serviceId, serviceTitle: listing.title });
  return { id: row.id };
}

const inquiryInclude = {
  service: { select: { id: true, title: true, status: true, worker: { select: { userId: true, user: { select: { fullName: true, phone: true } } } } } },
  customer: { select: { id: true, fullName: true, phone: true } },
  conversation: { select: { id: true } },
} satisfies Prisma.ServiceInquiryInclude;
type InquiryRow = Prisma.ServiceInquiryGetPayload<{ include: typeof inquiryInclude }>;

/** Phone numbers are shared only after the provider accepts, and only between the two people. */
function inquiryOut(r: InquiryRow, side: 'provider' | 'customer') {
  const accepted = r.status === 'ACCEPTED';
  return {
    id: r.id,
    status: r.status,
    message: r.message,
    preferredDate: r.preferredDate,
    createdAt: r.createdAt,
    respondedAt: r.respondedAt,
    conversationId: r.conversation?.id ?? null,
    service: { id: r.service.id, title: r.service.title, available: r.service.status === 'ACTIVE' },
    with: side === 'provider'
      ? { name: r.customer.fullName, phone: accepted ? r.customer.phone : null }
      : { name: r.service.worker.user.fullName, phone: accepted ? r.service.worker.user.phone : null },
  };
}

export async function receivedInquiries(providerUserId: string) {
  const rows = await prisma.serviceInquiry.findMany({
    where: { service: { worker: { userId: providerUserId } } },
    include: inquiryInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => inquiryOut(r, 'provider'));
}

export async function sentInquiries(customerId: string) {
  const rows = await prisma.serviceInquiry.findMany({ where: { customerId }, include: inquiryInclude, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((r) => inquiryOut(r, 'customer'));
}

export async function respondToInquiry(providerUserId: string, inquiryId: string, input: { accept: boolean; block?: boolean }) {
  const inq = await prisma.serviceInquiry.findFirst({ where: { id: inquiryId, service: { worker: { userId: providerUserId } } }, include: { service: { select: { title: true } } } });
  if (!inq) throw notFound('Inquiry not found');
  if (inq.status !== 'SENT') throw conflict('You already answered this inquiry');
  if (input.accept && input.block) throw badRequest('Accept or decline, not both');
  const now = new Date();
  if (input.accept) {
    await prisma.$transaction([
      prisma.serviceInquiry.update({ where: { id: inq.id }, data: { status: 'ACCEPTED', respondedAt: now } }),
      prisma.conversation.create({ data: { serviceInquiryId: inq.id, participants: { create: [{ userId: providerUserId }, { userId: inq.customerId }] } } }),
    ]);
    await notify(inq.customerId, 'service.inquiry_accepted', { inquiryId: inq.id, serviceId: inq.serviceId, serviceTitle: inq.service.title });
  } else {
    await prisma.$transaction([
      prisma.serviceInquiry.update({ where: { id: inq.id }, data: { status: 'DECLINED', respondedAt: now } }),
      ...(input.block ? [prisma.serviceBlock.upsert({ where: { providerUserId_customerId: { providerUserId, customerId: inq.customerId } }, update: {}, create: { providerUserId, customerId: inq.customerId } })] : []),
    ]);
    // Same wording whether or not the customer was blocked, so a block is never revealed.
    await notify(inq.customerId, 'service.inquiry_declined', { inquiryId: inq.id, serviceId: inq.serviceId, serviceTitle: inq.service.title });
  }
}

export async function cancelInquiry(customerId: string, inquiryId: string) {
  const { count } = await prisma.serviceInquiry.updateMany({ where: { id: inquiryId, customerId, status: 'SENT' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
  if (!count) throw conflict('Only an inquiry that is still waiting can be cancelled');
}
