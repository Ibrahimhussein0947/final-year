import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { uploadSingle } from '../files/storage';
import { checklistFor } from './status';
import { getIdentity, getLegal, identitySchema, legalSchema, myDocuments, saveIdentity, saveLegal, submitDocument, withdrawDocument } from './service';

const DOC_TYPES = ['BIRTH_CERTIFICATE', 'EDUCATION_CERTIFICATE', 'NATIONAL_ID', 'EXPERIENCE_LETTER', 'PROFESSIONAL_CERTIFICATE', 'BUSINESS_LICENSE', 'TIN_CERTIFICATE', 'COMMERCIAL_REGISTRATION', 'REPRESENTATIVE_ID', 'AUTHORIZATION_LETTER', 'ORG_REGISTRATION', 'GOVERNMENT_LETTER', 'AGENCY_LICENSE'] as const;

/**
 * Documents for job seekers and employers: the person types their details, uploads the paper, and the server compares what
 * it can read with what was typed. The comparison never marks anything verified: an administrator reviews every document.
 */
export function documentsRouter() {
  const router = Router();
  const worker = [requireAuth, requireRole('WORKER')];
  const employer = [requireAuth, requireRole('EMPLOYER')];
  const either = [requireAuth, requireRole('WORKER', 'EMPLOYER')];
  // Reading a picture is expensive, so uploads are limited per person.
  const uploads = rateLimit({
    windowMs: 60 * 60_000, limit: env.isTest ? 10_000 : 30, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon', validate: { keyGeneratorIpFallback: false },
    message: { error: { code: 'RATE_LIMITED', message: 'Too many documents uploaded. Please try again in an hour.' } },
  });

  // ── details to compare the documents with ──
  router.get('/workers/me/identity', ...worker, async (req, res) => {
    res.json({ identity: await getIdentity(req.user!.id) });
  });
  router.put('/workers/me/identity', ...worker, validateBody(identitySchema), async (req, res) => {
    const identity = await saveIdentity(req.user!.id, req.body);
    await audit(req, req.user!.id, 'worker.identity_saved', 'WorkerIdentity', req.user!.id);
    res.json({ identity });
  });
  router.get('/employers/me/legal', ...employer, async (req, res) => {
    res.json({ legal: await getLegal(req.user!.id) });
  });
  router.put('/employers/me/legal', ...employer, validateBody(legalSchema), async (req, res) => {
    const legal = await saveLegal(req.user!.id, req.body);
    await audit(req, req.user!.id, 'employer.legal_saved', 'OrganizationLegal', req.user!.id);
    res.json({ legal });
  });

  // ── what to upload, and the documents already sent ──
  router.get('/documents/checklist', ...either, async (req, res) => {
    res.json(await checklistFor(req.user!.id, req.user!.role as 'WORKER' | 'EMPLOYER'));
  });
  router.get('/documents', ...either, async (req, res) => {
    res.json({ items: await myDocuments(req.user!.id) });
  });
  const upload = async (req: Parameters<Parameters<typeof router.post>[1]>[0], res: Parameters<Parameters<typeof router.post>[1]>[1]) => {
    const body = z.object({ docType: z.enum(DOC_TYPES), educationId: z.string().uuid().optional(), experienceId: z.string().uuid().optional(), certificationId: z.string().uuid().optional() }).safeParse(req.body);
    if (!body.success) throw badRequest('Choose the kind of document', body.error.flatten().fieldErrors);
    const out = await submitDocument(req.user!.id, req.user!.role as 'WORKER' | 'EMPLOYER', body.data, req.file);
    await audit(req, req.user!.id, 'document.checked', 'VerificationRequest', out.requestId, { docType: body.data.docType, outcome: out.check.outcome });
    res.status(201).json(out);
  };
  const remove = async (req: Parameters<Parameters<typeof router.delete>[1]>[0], res: Parameters<Parameters<typeof router.delete>[1]>[1]) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound();
    await withdrawDocument(req.user!.id, id.data);
    res.status(204).end();
  };
  router.post('/documents', ...either, uploads, uploadSingle, upload);
  router.delete('/documents/:id', ...either, remove);
  // the original worker paths keep working
  router.get('/workers/me/documents', ...worker, async (req, res) => { res.json({ items: await myDocuments(req.user!.id) }); });
  router.post('/workers/me/documents', ...worker, uploads, uploadSingle, upload);
  router.delete('/workers/me/documents/:id', ...worker, remove);

  return router;
}
