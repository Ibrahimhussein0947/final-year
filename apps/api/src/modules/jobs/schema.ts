import { ORG_GROUPS, type OrgGroup } from '../hiring/catalog';
import { z } from 'zod';
import { jobCriterionInput } from '../criteria/service';

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACT', 'FREELANCE', 'INTERNSHIP', 'SEASONAL', 'DAILY'] as const;
export const WORK_MODES = ['ON_SITE', 'REMOTE', 'HYBRID'] as const;
const EDUCATION_LEVELS = ['NONE', 'PRIMARY', 'SECONDARY', 'VOCATIONAL_CERTIFICATE', 'DIPLOMA', 'BACHELOR', 'MASTER', 'DOCTORATE'] as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();

/** "2026-12-31" means the end of that day in Ethiopia (UTC+3), so a job stays open through its deadline day. */
const deadlineDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((s) => new Date(`${s}T23:59:59+03:00`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');
const startDate = z.coerce.date();

export const jobSkillInput = z.object({
  skillId: z.string().uuid(),
  importance: z.enum(['REQUIRED', 'PREFERRED']).default('REQUIRED'),
  minProficiency: z.number().int().min(1).max(5).nullable().optional(),
});

export const jobBaseSchema = z.object({
  title: text(5, 150),
  description: text(30, 10_000),
  categoryId: z.string().uuid(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workMode: z.enum(WORK_MODES).default('ON_SITE'),
  salaryMin: z.number().int().min(0).max(10_000_000).nullable().optional(),
  salaryMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
  vacancies: z.number().int().min(1).max(1000).default(1),
  deadline: deadlineDate.nullable().optional(),
  startDate: startDate.nullable().optional(),
  schedule: optionalText(300).optional(),
  benefits: optionalText(1000).optional(),
  minExperienceYears: z.number().int().min(0).max(50).nullable().optional(),
  requiredEducationLevel: z.enum(EDUCATION_LEVELS).nullable().optional(),
  languages: z.array(text(1, 30)).max(10).default([]),
  locationId: z.string().uuid().nullable().optional(),
  /** Vacancy reference number, as on a formal announcement (required by the hiring rules of some organization types). */
  referenceNumber: z.string().trim().max(40).transform((v) => (v === '' ? null : v)).nullable().optional()
    .refine((v) => v == null || /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/.test(v), 'Use letters, digits, spaces and . / _ -'),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  skills: z.array(jobSkillInput).max(20).default([]),
  /** Sector requirements (licence, registration, shifts...). Validated against the criterion definitions in the service. */
  criteria: z.array(jobCriterionInput).max(20).default([]),
  /** The employer reviewed and approved AI-suggested requirements (recorded as a timestamp). */
  extractionReviewed: z.boolean().optional(),
});

type Checkable = {
  salaryMin?: number | null;
  salaryMax?: number | null;
  lat?: number | null;
  lng?: number | null;
  skills?: { skillId: string }[];
};
const check = (v: Checkable, ctx: z.RefinementCtx) => {
  if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
    ctx.addIssue({ code: 'custom', path: ['salaryMax'], message: 'Maximum salary must be at least the minimum' });
  }
  if ((v.lat == null) !== (v.lng == null)) {
    ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Provide both latitude and longitude, or neither' });
  }
  const ids = (v.skills ?? []).map((s) => s.skillId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['skills'], message: 'Each skill can only be listed once' });
  }
};

// Strict: unknown fields such as status or organizationId are rejected, not silently ignored.
export const jobCreateSchema = jobBaseSchema.strict().superRefine(check);
// Updates may send any subset of fields (including skills, which replace the whole list).
export const jobUpdateSchema = jobBaseSchema.partial().strict().superRefine(check);

export const publishSchema = z.object({ confirmNotDuplicate: z.boolean().optional() }).default({});

export const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(), // slug
  categoryId: z.string().uuid().optional(),
  region: z.string().trim().max(80).optional(), // region name
  locationId: z.string().uuid().optional(),
  type: z.enum(EMPLOYMENT_TYPES).optional(),
  mode: z.enum(WORK_MODES).optional(),
  minSalary: z.coerce.number().int().min(0).optional(),
  verifiedOnly: z.enum(['true', 'false']).optional(),
  /** Kind of employer: business, public, nonprofit, individual, agency or institution. */
  employerGroup: z.enum(ORG_GROUPS as [OrgGroup, ...OrgGroup[]]).optional(),
  /** Only jobs that state a salary (many do not; a missing salary is "not stated", never treated as zero). */
  hasSalary: z.enum(['true', 'false']).optional(),
  /** Flexible work: part-time, temporary, daily, seasonal or freelance work, or remote/hybrid, or a stated flexible schedule. */
  flexible: z.enum(['true', 'false']).optional(),
  /** Jobs that start within this many days (jobs with no start date are kept: "start date not stated"). */
  startWithin: z.coerce.number().int().min(0).max(365).optional(),
  /** Jobs published in the last N days. */
  postedWithin: z.coerce.number().int().min(1).max(365).optional(),
  /** Jobs asking for at most this many years of experience (jobs that state none are kept). 0 = no experience needed. */
  maxExperience: z.coerce.number().int().min(0).max(50).optional(),
  /** Jobs asking for at most this education level (jobs that state none are kept): lets people without schooling find work they can do. */
  maxEducation: z.enum(EDUCATION_LEVELS).optional(),
  language: z.string().trim().min(2).max(30).optional(),
  /** Comma-separated skill ids: jobs that list any of them. */
  skills: z.string().trim().max(400).optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .refine((a) => a.length <= 10 && a.every((x) => /^[0-9a-f-]{36}$/i.test(x)), 'Up to 10 valid skill ids'),
  sort: z.enum(['newest', 'deadline', 'salary']).default('newest'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export type JobCreateInput = z.infer<typeof jobCreateSchema>;
export type JobUpdateInput = z.infer<typeof jobUpdateSchema>;
