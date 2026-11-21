import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { notifier } from '../../integrations/notify';
import { emitToUser } from '../../realtime';
import { sendTelegramIfAllowed, telegramTextFor } from './telegram';

export type NotificationType =
  | 'application.received'
  | 'application.withdrawn'
  | 'application.status'
  | 'interview.scheduled'
  | 'interview.cancelled'
  | 'interview.responded'
  | 'interview.reminder'
  | 'message.new'
  | 'job.recommended'
  | 'search.match'
  | 'job.matches'
  | 'application.auto'
  | 'job.invitation'
  | 'verification.reviewed'
  | 'job.reviewed'
  | 'plan.request_decided'
  | 'cv.accepted'
  | 'offer.made'
  | 'offer.responded'
  | 'offer.withdrawn'
  | 'offer.expired'
  | 'offer.started'
  | 'offer.reminder'
  | 'appeal.received'
  | 'appeal.answered'
  | 'service.inquiry'
  | 'service.inquiry_accepted'
  | 'service.inquiry_declined'
  | 'service.removed';

const SMS_PER_DAY = 5;

/**
 * SMS text is deliberately generic. It never contains job titles, names or messages, because those are written by
 * other users and could be used to send phishing or spam through our SMS channel.
 */
export function smsTextFor(type: NotificationType, payload: Record<string, unknown>): string | null {
  if (type === 'interview.reminder' && payload.audience === 'worker') return 'EthioTalent AI: you have an interview coming up. Open the app for the time and place.';
  if (type === 'offer.made') return 'EthioTalent AI: you have a job offer. Open the app to read it and answer.';
  if (type === 'offer.reminder' && payload.audience === 'worker') return 'EthioTalent AI: a reminder about your job offer. Open the app for the date.';
  if (type === 'interview.scheduled') return 'EthioTalent AI: an interview has been scheduled for you. Open the app for the details.';
  if (type === 'application.status' && ['SHORTLISTED', 'ACCEPTED', 'REJECTED'].includes(String(payload.status))) {
    return 'EthioTalent AI: the status of one of your applications has changed. Open the app to see it.';
  }
  return null;
}

async function sendSmsIfAllowed(userId: string, text: string) {
  if (!notifier.smsConfigured()) return; // no gateway: say nothing, send nothing
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true, notifySms: true, status: true } });
  if (!user || user.status !== 'ACTIVE' || !user.notifySms || !user.phoneVerifiedAt) return;
  const sentToday = await prisma.auditLog.count({ where: { actorId: userId, action: 'sms.sent', createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (sentToday >= SMS_PER_DAY) return;
  await notifier.sendSms(user.phone, text);
  await prisma.auditLog.create({ data: { actorId: userId, action: 'sms.sent', entityType: 'Notification' } });
}

/**
 * Stores an in-app notification, pushes it to any open session in real time, and sends an optional SMS for the
 * few important types. A failure here never breaks the action that triggered it.
 */
export async function notify(userId: string, type: NotificationType, payload: Prisma.InputJsonValue) {
  try {
    const n = await prisma.notification.create({ data: { userId, type, payload } });
    emitToUser(userId, 'notification:new', { id: n.id, type, payload, readAt: null, createdAt: n.createdAt });
    const sms = smsTextFor(type, (payload ?? {}) as Record<string, unknown>);
    if (sms) await sendSmsIfAllowed(userId, sms);
    const tg = telegramTextFor(type, (payload ?? {}) as Record<string, unknown>);
    if (tg) await sendTelegramIfAllowed(userId, tg);
  } catch (err) {
    logger.error({ err, type }, 'notification delivery failed');
  }
}
