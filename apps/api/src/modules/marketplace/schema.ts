import { z } from 'zod';
import { PAY_BASES } from '../jobs/classification';

export const SERVICE_MODES = ['AT_CUSTOMER', 'AT_PROVIDER', 'REMOTE'] as const;

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();

export const listingBaseSchema = z.object({
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(30).max(3000),
  categoryId: z.string().uuid(),
  serviceMode: z.enum(SERVICE_MODES).default('AT_CUSTOMER'),
  /** What priceMin and priceMax count: per hour, per day, per project... Empty means the price is not stated. */
  payBasis: z.enum(PAY_BASES).nullable().optional(),
  priceMin: z.number().int().min(0).max(10_000_000).nullable().optional(),
  priceMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
  toolsIncluded: z.boolean().default(false),
  availability: optionalText(200).optional(),
  /** The area served (never an exact address). Required unless the service is done remotely. */
  locationId: z.string().uuid().nullable().optional(),
  skillIds: z.array(z.string().uuid()).max(15).default([]).transform((v) => [...new Set(v)]),
});

const priceOrder = (v: { priceMin?: number | null; priceMax?: number | null }, ctx: z.RefinementCtx) => {
  if (v.priceMin != null && v.priceMax != null && v.priceMin > v.priceMax) {
    ctx.addIssue({ code: 'custom', path: ['priceMax'], message: 'The highest price must be at least the lowest' });
  }
};

export const listingCreateSchema = listingBaseSchema.strict().superRefine(priceOrder);
export const listingUpdateSchema = listingBaseSchema.partial().strict().superRefine(priceOrder);

export const listingQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(), // slug
  region: z.string().trim().max(80).optional(), // region name
  locationId: z.string().uuid().optional(),
  mode: z.enum(SERVICE_MODES).optional(),
  payBasis: z.enum(PAY_BASES).optional(),
  verifiedOnly: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'trusted']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});
export type ListingQuery = z.infer<typeof listingQuerySchema>;

export const askSchema = z.object({ text: z.string().trim().min(10).max(500) }).strict();

export const inquirySchema = z
  .object({
    message: z.string().trim().min(10, 'Say what you need in at least 10 characters').max(1000),
    preferredDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
      .optional()
      .refine((d) => !d || d >= new Date().toISOString().slice(0, 10), 'Choose today or a later day'),
  })
  .strict();

export const respondSchema = z.object({ accept: z.boolean(), block: z.boolean().optional() }).strict();
