import { z } from 'zod';
import { PHONE_REGEX, normalizePhone, stripPhoneFormatting } from '../../lib/security';

const phone = z
  .string()
  .trim()
  .transform(stripPhoneFormatting)
  .pipe(z.string().regex(PHONE_REGEX, 'Enter a valid Ethiopian mobile number'))
  .transform(normalizePhone);

// bcrypt only uses the first 72 bytes, so cap the length instead of silently truncating.
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

const optionalText = z.string().trim().max(80).optional().transform((v) => (v ? v : undefined));

const ORG_TYPES = [
  'PRIVATE_COMPANY', 'PUBLIC_ENTERPRISE', 'GOVERNMENT', 'NGO', 'SME', 'CONSTRUCTION', 'FACTORY', 'HOTEL_RESTAURANT',
  'AGRICULTURAL', 'HOUSEHOLD', 'INDIVIDUAL', 'RECRUITMENT_AGENCY', 'TRAINING_INSTITUTION', 'COOPERATIVE',
] as const;

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    phone,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(254)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    password,
    // ADMIN and TRAINER can never be self-registered.
    role: z.enum(['WORKER', 'EMPLOYER']),
    region: z.string().trim().min(1).max(80),
    zone: optionalText,
    woreda: optionalText,
    kebele: optionalText,
    language: z.enum(['en', 'am', 'om']).default('en'),
    organizationName: z.string().trim().min(2).max(150).optional(),
    organizationType: z.enum(ORG_TYPES).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'EMPLOYER') {
      if (!v.organizationName) ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'Organization name is required' });
      if (!v.organizationType) ctx.addIssue({ code: 'custom', path: ['organizationType'], message: 'Organization type is required' });
    }
  });

/** Sign-in name: an Ethiopian mobile number or an email address. Phones are normalised, emails lower-cased. */
const loginName = z
  .string()
  .trim()
  .min(3, 'Enter your phone number or email')
  .max(254)
  .transform((v, ctx) => {
    if (v.includes('@')) {
      const email = z.string().email().safeParse(v.toLowerCase());
      if (!email.success) { ctx.addIssue({ code: 'custom', message: 'Enter a valid email address' }); return z.NEVER; }
      return email.data;
    }
    const digits = stripPhoneFormatting(v);
    if (!PHONE_REGEX.test(digits)) { ctx.addIssue({ code: 'custom', message: 'Enter a valid Ethiopian mobile number or an email address' }); return z.NEVER; }
    return normalizePhone(digits);
  });

export const loginSchema = z.object({
  phone: loginName,
  password: z.string().min(1).max(200),
  totpCode: z.string().trim().regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, 'Enter the 6-digit code or a backup code').optional(),
});

export const otpRequestSchema = z.object({ kind: z.enum(['PHONE', 'EMAIL']) });
export const otpVerifySchema = z.object({
  kind: z.enum(['PHONE', 'EMAIL']),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ phone });
export const resetPasswordSchema = z.object({
  phone,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: password,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const totpDisableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(200) });
