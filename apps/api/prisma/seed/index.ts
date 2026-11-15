import { PrismaClient } from '@prisma/client';
import { categories, defaultWeights, regions, relations, skills } from './data';
import { criteria } from './criteria';
import { hiringPolicies } from './policies';

const prisma = new PrismaClient();

async function seedLocations() {
  for (const r of regions) {
    let region = await prisma.location.findFirst({ where: { level: 'REGION', nameEn: r.en, parentId: null } });
    if (region) {
      region = await prisma.location.update({
        where: { id: region.id },
        data: { nameAm: r.am, nameOm: r.om, lat: r.lat, lng: r.lng },
      });
    } else {
      region = await prisma.location.create({
        data: { level: 'REGION', nameEn: r.en, nameAm: r.am, nameOm: r.om, lat: r.lat, lng: r.lng },
      });
    }
    for (const z of r.zones) {
      await prisma.location.upsert({
        where: { parentId_nameEn: { parentId: region.id, nameEn: z.en } },
        update: { lat: z.lat, lng: z.lng },
        create: { level: 'ZONE', nameEn: z.en, parentId: region.id, lat: z.lat, lng: z.lng },
      });
    }
  }
}

async function seedTaxonomy() {
  const catIds = new Map<string, string>();
  for (const c of categories) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { nameEn: c.en },
      create: { slug: c.slug, nameEn: c.en },
    });
    catIds.set(c.slug, row.id);
  }
  const skillIds = new Map<string, string>();
  for (const [slug, cat, nameEn, aliases] of skills) {
    const categoryId = catIds.get(cat);
    if (!categoryId) throw new Error(`Unknown category ${cat} for skill ${slug}`);
    const row = await prisma.skill.upsert({
      where: { slug },
      update: { nameEn, aliases, categoryId },
      create: { slug, nameEn, aliases, categoryId },
    });
    skillIds.set(slug, row.id);
  }
  for (const [a, b, type, weight] of relations) {
    const skillAId = skillIds.get(a);
    const skillBId = skillIds.get(b);
    if (!skillAId || !skillBId) throw new Error(`Unknown skill in relation ${a} -> ${b}`);
    await prisma.skillRelation.upsert({
      where: { skillAId_skillBId: { skillAId, skillBId } },
      update: { type, weight },
      create: { skillAId, skillBId, type, weight },
    });
  }
}

async function seedWeights() {
  const existing = await prisma.matchWeights.findFirst({ where: { categoryId: null, version: 1 } });
  if (!existing) {
    await prisma.matchWeights.create({ data: { categoryId: null, version: 1, weights: defaultWeights, active: true } });
  }
}

async function seedCriteria() {
  const cats = new Map((await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  let order = 0;
  for (const c of criteria) {
    const categoryId = c.category ? cats.get(c.category) ?? null : null;
    if (c.category && !categoryId) throw new Error(`Unknown category in criteria seed: ${c.category}`);
    const data = {
      labelEn: c.labelEn, helpEn: c.helpEn ?? null, type: c.type, options: (c.options ?? undefined) as unknown as object | undefined, unit: c.unit ?? null,
      minValue: c.min ?? null, maxValue: c.max ?? null, mustHaveAllowed: c.mustHaveAllowed ?? true, evidenceSuggested: c.evidence ?? false, sortOrder: order++,
    };
    // Existing rows are left as the administrator may have edited them (labels, translations, hidden): only create what is missing.
    const exists = await prisma.criterionDefinition.findFirst({ where: { categoryId, key: c.key } });
    if (!exists) await prisma.criterionDefinition.create({ data: { categoryId, key: c.key, ...data } });
  }
}

async function seedPolicies() {
  // Create only what is missing: an administrator's edits are never overwritten.
  for (const [organizationType, p] of Object.entries(hiringPolicies)) {
    const exists = await prisma.hiringPolicy.findUnique({ where: { organizationType: organizationType as 'GOVERNMENT' } });
    if (!exists) await prisma.hiringPolicy.create({ data: { organizationType: organizationType as 'GOVERNMENT', ...p } });
  }
}

async function seedPlans() {
  // Starting plans written by the developer; the prices are placeholders for the administrator to set. Created only if missing.
  const plans = [
    { slug: 'free', name: 'Free', description: 'For small employers getting started.', priceEtbMonthly: 0, maxActiveJobs: 10, maxInvitationsPerMonth: 30, maxFeaturedJobs: 0, maxApplicationsReviewedPerMonth: 100, canSearchWorkers: true, isDefault: true, sortOrder: 1 },
    { slug: 'standard', name: 'Standard', description: 'More open jobs and invitations for growing employers.', priceEtbMonthly: 1500, maxActiveJobs: 30, maxInvitationsPerMonth: 200, maxFeaturedJobs: 3, maxApplicationsReviewedPerMonth: 1000, canSearchWorkers: true, isDefault: false, sortOrder: 2 },
    { slug: 'premium', name: 'Premium', description: 'No limits on open jobs or invitations.', priceEtbMonthly: 5000, maxActiveJobs: null, maxInvitationsPerMonth: null, maxFeaturedJobs: null, maxApplicationsReviewedPerMonth: null, canSearchWorkers: true, isDefault: false, sortOrder: 3 },
  ];
  if ((await prisma.subscriptionPlan.count()) > 0) return;
  for (const p of plans) await prisma.subscriptionPlan.create({ data: p });
}

async function main() {
  await seedLocations();
  await seedTaxonomy();
  await seedWeights();
  await seedCriteria();
  await seedPolicies();
  await seedPlans();
  const [loc, cat, sk, rel, crit] = await Promise.all([
    prisma.location.count(),
    prisma.category.count(),
    prisma.skill.count(),
    prisma.skillRelation.count(),
    prisma.criterionDefinition.count(),
  ]);
  console.log(`Seeded: ${loc} locations, ${cat} categories, ${sk} skills, ${rel} skill relations, ${crit} sector criteria`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
