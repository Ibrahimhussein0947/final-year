import type { Prisma } from '@prisma/client';

type ProfileForScore = Prisma.WorkerProfileGetPayload<{
  include: { _count: { select: { skills: true; education: true; certifications: true; experiences: true; activities: true } } };
}>;

/**
 * Profile completion is a transparent checklist (sums to 100). Formal education is deliberately
 * optional: any one of work history, education or certification counts as "background".
 */
export const COMPLETION_ITEMS: { key: string; label: string; points: number; done: (p: ProfileForScore) => boolean }[] = [
  { key: 'headline', label: 'Professional headline', points: 10, done: (p) => !!p.headline?.trim() },
  { key: 'bio', label: 'Short biography', points: 10, done: (p) => !!p.bio && p.bio.trim().length >= 20 },
  { key: 'occupation', label: 'Occupation and category', points: 10, done: (p) => !!p.occupation?.trim() && !!p.categoryId },
  { key: 'location', label: 'Location', points: 10, done: (p) => !!p.locationId },
  { key: 'skills', label: 'At least 3 skills', points: 20, done: (p) => p._count.skills >= 3 },
  {
    key: 'background',
    label: 'Work history, education, training, apprenticeship or certification',
    points: 10,
    done: (p) => p._count.experiences + p._count.education + p._count.certifications + p._count.activities > 0,
  },
  {
    key: 'preferences',
    label: 'Salary or job-type preferences',
    points: 10,
    done: (p) => p.preferredTypes.length > 0 || p.expectedSalaryMin !== null || p.expectedSalaryMax !== null,
  },
  { key: 'languages', label: 'Languages', points: 5, done: (p) => p.languages.length > 0 },
  { key: 'travel', label: 'Travel distance or relocation', points: 5, done: (p) => p.maxTravelKm !== null || p.willingToRelocate },
  { key: 'photo', label: 'Profile photo', points: 5, done: (p) => !!p.photoFileId },
  { key: 'cv', label: 'CV uploaded', points: 5, done: (p) => !!p.cvFileId },
];

export function scoreProfile(p: ProfileForScore) {
  const items = COMPLETION_ITEMS.map((i) => ({ key: i.key, label: i.label, points: i.points, done: i.done(p) }));
  return { pct: items.reduce((s, i) => s + (i.done ? i.points : 0), 0), items };
}
