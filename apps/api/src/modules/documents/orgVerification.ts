import type { VerificationStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { employerRequirements } from './requirements';

/**
 * Keeps an organization's verification status in step with its documents:
 * - VERIFIED once an administrator has approved EVERY required document for its type;
 * - REJECTED when a required document's latest request was rejected (it has to upload a better one);
 * - PENDING while something is waiting for review or some documents are approved and others are not yet sent;
 * - UNVERIFIED when nothing is waiting or approved.
 * An organization that is already VERIFIED is never moved down by this: it was verified under the older single-document
 * rule, or all its documents were approved, and the administrator can still change it by hand.
 */
export async function syncOrgVerification(orgId: string): Promise<VerificationStatus> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { type: true, verificationStatus: true } });
  const required = employerRequirements(org.type).filter((r) => r.required).map((r) => r.key as string);
  const rows = await prisma.verificationRequest.findMany({ where: { kind: 'EMPLOYER', targetId: orgId, targetType: { not: null } }, orderBy: { createdAt: 'desc' }, select: { targetType: true, status: true } });
  const latest = new Map<string, 'PENDING' | 'APPROVED' | 'REJECTED'>();
  for (const r of rows) if (r.targetType && !latest.has(r.targetType)) latest.set(r.targetType, r.status);

  const allApproved = required.length > 0 && required.every((k) => latest.get(k) === 'APPROVED');
  const anyRejected = required.some((k) => latest.get(k) === 'REJECTED');
  const anyActive = [...latest.values()].some((s) => s === 'PENDING' || s === 'APPROVED');
  const next: VerificationStatus = allApproved ? 'VERIFIED' : anyRejected ? 'REJECTED' : anyActive ? 'PENDING' : 'UNVERIFIED';

  if (org.verificationStatus === 'VERIFIED' && next !== 'VERIFIED') return org.verificationStatus;
  if (next !== org.verificationStatus) {
    await prisma.organization.update({ where: { id: orgId }, data: { verificationStatus: next, ...(next === 'VERIFIED' ? { verifiedAt: new Date() } : {}) } });
  }
  return next;
}
