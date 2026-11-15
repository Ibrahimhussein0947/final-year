import { z } from 'zod';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACT', 'FREELANCE', 'INTERNSHIP', 'SEASONAL', 'DAILY'] as const;
const WORK_MODES = ['ON_SITE', 'REMOTE', 'HYBRID'] as const;
const AVAILABILITY = ['IMMEDIATELY', 'WITHIN_TWO_WEEKS', 'WITHIN_ONE_MONTH', 'FLEXIBLE', 'NOT_AVAILABLE'] as const;
const EDUCATION_LEVELS = ['NONE', 'PRIMARY', 'SECONDARY', 'VOCATIONAL_CERTIFICATE', 'DIPLOMA', 'BACHELOR', 'MASTER', 'DOCTORATE'] as const;

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).transform((v) => (v === '' ? null : v)).nullable();
const salary = z.number().int().min(0).max(10_000_000).nullable();
// Only web links: blocks javascript:, data: and similar schemes that would be dangerous if rendered as hrefs.
const httpUrl = z
  .string()
  .trim()
  .max(300)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Links must start with http:// or https://');

export const profileUpdateSchema = z
  .object({
    headline: nullableText(120),
    bio: nullableText(2000),
    occupation: nullableText(100),
    categoryId: z.string().uuid().nullable(),
    yearsExperience: z.number().int().min(0).max(60),
    expectedSalaryMin: salary,
    expectedSalaryMax: salary,
    preferredTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(8),
    preferredWorkModes: z.array(z.enum(WORK_MODES)).max(3),
    availability: z.enum(AVAILABILITY),
    availableFrom: z.coerce.date().nullable(),
    locationId: z.string().uuid().nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    maxTravelKm: z.number().int().min(0).max(3000).nullable(),
    willingToRelocate: z.boolean(),
    languages: z.array(text(30).min(1)).max(10),
    portfolioUrls: z.array(httpUrl).max(10),
    isVisible: z.boolean(),
  })
  .partial()
  .strict()
  .superRefine((v, ctx) => {
    if (v.expectedSalaryMin != null && v.expectedSalaryMax != null && v.expectedSalaryMin > v.expectedSalaryMax) {
      ctx.addIssue({ code: 'custom', path: ['expectedSalaryMax'], message: 'Maximum must be at least the minimum' });
    }
    if ((v.lat === undefined) !== (v.lng === undefined) || (v.lat === null) !== (v.lng === null)) {
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Provide both latitude and longitude, or clear both' });
    }
  });

export const skillSchema = z.object({
  proficiency: z.number().int().min(1).max(5),
  years: z.number().int().min(0).max(60).nullable().optional(),
});

export const educationSchema = z
  .object({
    level: z.enum(EDUCATION_LEVELS),
    field: nullableText(120).optional(),
    institution: nullableText(150).optional(),
    department: nullableText(120).optional(),
    // Optional on purpose: many routes (vocational, informal, older systems) have no GPA. Missing is "not provided", never zero.
    gpa: z.number().min(0).max(100).nullable().optional(),
    gpaScale: z.number().positive().max(100).nullable().optional(),
    year: z.number().int().min(1950).max(new Date().getFullYear() + 6).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.gpa != null && v.gpaScale == null) ctx.addIssue({ code: 'custom', path: ['gpaScale'], message: 'Say what scale the GPA is on (for example 4 or 100)' });
    if (v.gpa != null && v.gpaScale != null && v.gpa > v.gpaScale) ctx.addIssue({ code: 'custom', path: ['gpa'], message: 'GPA cannot be higher than its scale' });
    if (v.gpa == null && v.gpaScale != null) ctx.addIssue({ code: 'custom', path: ['gpa'], message: 'Enter the GPA or clear the scale' });
  })
  // A cleared GPA clears its scale too.
  .transform((v) => (v.gpa == null ? { ...v, gpa: null, gpaScale: null } : v));

export const certificationSchema = z.object({
  name: text(150).min(2),
  issuer: nullableText(150).optional(),
  year: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().optional(),
});

export const experienceSchema = z
  .object({
    title: text(120).min(2),
    employer: nullableText(150).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable().optional(),
    description: nullableText(1500).optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'End date must be after the start date' });

export const ACTIVITY_KINDS = ['INTERNSHIP', 'VOLUNTEER', 'TRAINING', 'APPRENTICESHIP', 'REFERENCE'] as const;

/**
 * Internships, volunteer service, training, apprenticeships (learning a trade from a master) and references.
 * For a REFERENCE, `title` is the person's name and `organization` their relationship ("former employer", "village elder").
 * No phone number or address for the referee is stored: it would be personal data of someone who never agreed to it.
 */
export const activitySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    title: text(120).min(2),
    organization: nullableText(150).optional(),
    startDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    hours: z.number().int().min(0).max(100_000).nullable().optional(),
    description: nullableText(1500).optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'End date must be after the start date' });
