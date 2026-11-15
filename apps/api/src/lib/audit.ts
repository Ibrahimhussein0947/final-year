import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';

/** Best-effort audit trail. A failed audit write must never break the request. */
export async function audit(
  req: Request | null,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId?: string,
  meta?: Prisma.InputJsonValue,
) {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, entityType, entityId, meta, ip: req?.ip },
    });
  } catch (err) {
    logger.error({ err, action }, 'audit write failed');
  }
}
