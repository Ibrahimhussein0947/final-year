import type { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';

/**
 * Platform switches an administrator can change without a deployment. Only the keys below exist: the API rejects
 * anything else, and every change is written to the activity log by the route.
 */
export const settingsSchema = z
  .object({
    maintenanceEnabled: z.boolean(),
    maintenanceMessage: z.string().trim().max(300),
    registrationOpen: z.boolean(),
    dailyApplicationLimit: z.number().int().min(1).max(200),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const SETTING_KEYS = Object.keys(settingsSchema.shape) as (keyof Settings)[];

export const DEFAULT_SETTINGS: Settings = {
  maintenanceEnabled: false,
  maintenanceMessage: '',
  registrationOpen: true,
  dailyApplicationLimit: 30,
};

export const settingsPatchSchema = settingsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one setting');

/** Where settings live. The database store is used in production; tests can pass an in-memory one so they never touch shared state. */
export interface SettingsStore {
  read(): Promise<Settings>;
  write(patch: Partial<Settings>, adminId: string): Promise<Settings>;
}

export const databaseStore: SettingsStore = {
  async read() {
    const rows = await prisma.platformSetting.findMany();
    const out: Settings = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      const key = r.key as keyof Settings;
      if (!SETTING_KEYS.includes(key)) continue;
      const ok = settingsSchema.shape[key].safeParse(r.value);
      if (ok.success) (out as Record<string, unknown>)[key] = ok.data; // a malformed stored value falls back to the default
    }
    return out;
  },
  async write(patch, adminId) {
    await prisma.$transaction(
      Object.entries(patch).map(([key, value]) =>
        prisma.platformSetting.upsert({
          where: { key },
          update: { value: value as never, updatedById: adminId },
          create: { key, value: value as never, updatedById: adminId },
        }),
      ),
    );
    return databaseStore.read();
  },
};

export function memoryStore(initial: Partial<Settings> = {}): SettingsStore {
  let current: Settings = { ...DEFAULT_SETTINGS, ...initial };
  return {
    async read() { return { ...current }; },
    async write(patch) { current = { ...current, ...patch }; return { ...current }; },
  };
}

let store: SettingsStore = databaseStore;
let cache: { at: number; value: Settings } | null = null;
const TTL_MS = 10_000; // other server processes see a change within this long

export function useSettingsStore(s: SettingsStore) {
  store = s;
  cache = null;
}

export async function getSettings(): Promise<Settings> {
  if (store !== databaseStore) return store.read();
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await store.read();
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(patch: Partial<Settings>, adminId: string): Promise<Settings> {
  const value = await store.write(patch, adminId);
  cache = null;
  return value;
}

// Paths that keep working in maintenance mode: sign-in (so an administrator can get in and switch it off), the admin area and the status check.
const OPEN_DURING_MAINTENANCE = ['/health', '/api/v1/auth', '/api/v1/admin', '/api/v1/site'];

export function maintenanceGuard(): RequestHandler {
  return async (req, res, next) => {
    try {
      const s = await getSettings();
      if (!s.maintenanceEnabled || OPEN_DURING_MAINTENANCE.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
      res.setHeader('Retry-After', '300');
      res.status(503).json({ error: { code: 'MAINTENANCE', message: s.maintenanceMessage || 'The platform is being maintained. Please try again in a few minutes.' } });
    } catch (err) {
      logger.error({ err }, 'could not read platform settings; continuing without maintenance mode');
      next();
    }
  };
}

export async function assertRegistrationOpen() {
  if (!(await getSettings()).registrationOpen) throw new AppError(403, 'REGISTRATION_CLOSED', 'New registrations are closed for now. Please try again later.');
}
