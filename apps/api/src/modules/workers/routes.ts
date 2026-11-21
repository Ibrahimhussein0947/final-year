import { getWorkerCriteria, setWorkerCriteria, workerCriteriaInput } from '../criteria/service';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { deleteFileAsset, saveUpload, uploadSingle } from '../files/storage';
import {
  activitySchema, certificationSchema, educationSchema, experienceSchema, profileUpdateSchema, skillSchema,
} from './schema';
import * as svc from './service';
import { checkCv, mismatchError, opportunitiesAfterAcceptance } from '../verification/service';
import { listMyProfileViews, recordProfileView } from './views';
import { myTrust } from './trust';
import { buildCv } from './cv';
import { addPortfolioItem, deletePortfolioItem, listPortfolio, portfolioSchema, updatePortfolioItem } from './portfolio';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workerId?: string;
    }
  }
}

const uuid = z.string().uuid();
const idParam = (req: Request, name = 'id') => {
  const r = uuid.safeParse(req.params[name]);
  if (!r.success) throw notFound();
  return r.data;
};

async function loadWorker(req: Request, _res: Response, next: NextFunction) {
  req.workerId = await svc.workerIdFor(req.user!.id);
  next();
}

export function workersRouter() {
  const router = Router();
  const mine = [requireAuth, requireRole('WORKER'), loadWorker];

  // Photos of finished work.
  router.get('/me/portfolio', ...mine, async (req, res) => {
    res.json({ items: await listPortfolio(req.workerId!) });
  });
  router.post('/me/portfolio', ...mine, uploadSingle, async (req, res) => {
    const body = portfolioSchema.safeParse({ caption: req.body?.caption, skillId: req.body?.skillId || undefined });
    if (!body.success) throw badRequest('Check the caption and skill', body.error.flatten().fieldErrors);
    const item = await addPortfolioItem(req.user!.id, req.workerId!, req.file, body.data);
    await audit(req, req.user!.id, 'worker.portfolio_added', 'PortfolioItem', item.id);
    res.status(201).json({ item, items: await listPortfolio(req.workerId!) });
  });
  router.patch('/me/portfolio/:id', ...mine, validateBody(portfolioSchema), async (req, res) => {
    res.json({ item: await updatePortfolioItem(req.workerId!, idParam(req), req.body) });
  });
  router.delete('/me/portfolio/:id', ...mine, async (req, res) => {
    await deletePortfolioItem(req.workerId!, idParam(req));
    res.json({ items: await listPortfolio(req.workerId!) });
  });

  // How much of the profile an administrator has checked, and what would raise it.
  // CV builder: the worker's own profile as a PDF, in English, Amharic or Afaan Oromoo. Built on request, never stored.
  router.get('/me/cv.pdf', ...mine, async (req, res) => {
    const lang = z.enum(['en', 'am', 'om']).default('en').parse(req.query.lang ?? undefined);
    const pdf = await buildCv(req.workerId!, lang);
    await audit(req, req.user!.id, 'worker.cv_generated', 'WorkerProfile', req.workerId!, { lang });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="cv.pdf"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(pdf);
  });

  router.get('/me/trust', ...mine, async (req, res) => {
    res.json({ trust: await myTrust(req.workerId!) });
  });
  router.get('/me', ...mine, async (req, res) => {
    res.json({ profile: await svc.getOwnProfile(req.workerId!) });
  });

  router.patch('/me', ...mine, validateBody(profileUpdateSchema), async (req, res) => {
    await svc.updateProfile(req.workerId!, req.body);
    res.json({ profile: await svc.getOwnProfile(req.workerId!) });
  });

  // Which organisations looked at this profile (organisation level only).
  router.get('/me/views', ...mine, async (req, res) => {
    res.json(await listMyProfileViews(req.workerId!));
  });

  // Sector criteria (Phase 15): answers to the sector questions (licence, shifts, tools...)
  router.get('/me/criteria', ...mine, async (req, res) => {
    res.json({ items: await getWorkerCriteria(req.workerId!) });
  });

  router.put('/me/criteria', ...mine, validateBody(workerCriteriaInput), async (req, res) => {
    await setWorkerCriteria(req.workerId!, req.body.items);
    await audit(req, req.user!.id, 'worker.criteria_updated', 'WorkerProfile', req.workerId!, { count: req.body.items.length });
    res.json({ items: await getWorkerCriteria(req.workerId!) });
  });

  // Skills
  router.put('/me/skills/:skillId', ...mine, validateBody(skillSchema), async (req, res) => {
    await svc.upsertSkill(req.workerId!, idParam(req, 'skillId'), req.body.proficiency, req.body.years);
    res.json({ profile: await svc.getOwnProfile(req.workerId!) });
  });
  router.delete('/me/skills/:skillId', ...mine, async (req, res) => {
    await svc.removeSkill(req.workerId!, idParam(req, 'skillId'));
    res.json({ profile: await svc.getOwnProfile(req.workerId!) });
  });

  // Education, certifications, work history
  const children = [
    ['education', 'education', educationSchema],
    ['certifications', 'certification', certificationSchema],
    ['experience', 'workExperience', experienceSchema],
    ['activities', 'profileActivity', activitySchema],
  ] as const;
  for (const [path, kind, schema] of children) {
    router.post(`/me/${path}`, ...mine, validateBody(schema), async (req, res) => {
      await svc.createChild(kind, req.workerId!, req.body);
      res.status(201).json({ profile: await svc.getOwnProfile(req.workerId!) });
    });
    router.put(`/me/${path}/:id`, ...mine, validateBody(schema), async (req, res) => {
      await svc.updateChild(kind, req.workerId!, idParam(req), req.body);
      res.json({ profile: await svc.getOwnProfile(req.workerId!) });
    });
    router.delete(`/me/${path}/:id`, ...mine, async (req, res) => {
      await svc.deleteChild(kind, req.workerId!, idParam(req));
      res.json({ profile: await svc.getOwnProfile(req.workerId!) });
    });
    // Supporting document (certificate, transcript, letter): PDF/JPG/PNG up to 5 MB; visible to the owner and to employers the worker applied to.
    if (kind !== 'workExperience') {
      router.post(`/me/${path}/:id/document`, ...mine, uploadSingle, async (req, res) => {
        const asset = await saveUpload(req.user!.id, 'CERTIFICATE', req.file);
        try {
          const replaced = await svc.attachDocument(kind, req.workerId!, idParam(req), asset.id);
          await deleteFileAsset(replaced);
        } catch (err) {
          await deleteFileAsset(asset.id); // no orphan file when the row is not theirs
          throw err;
        }
        res.status(201).json({ profile: await svc.getOwnProfile(req.workerId!) });
      });
    }
  }

  // Photo and CV uploads
  for (const [path, kind, field] of [
    ['photo', 'PROFILE_PHOTO', 'photoFileId'],
    ['cv', 'CV', 'cvFileId'],
  ] as const) {
    const currentFileId = async (workerId: string): Promise<string | null> => {
      const row = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, select: { photoFileId: true, cvFileId: true } });
      return row[field];
    };
    router.post(`/me/${path}`, ...mine, uploadSingle, async (req, res) => {
      const asset = await saveUpload(req.user!.id, kind, req.file);
      // A CV is compared with the profile before it is accepted: someone else's CV, or one that contradicts the details, is declined.
      let cvCheck: Awaited<ReturnType<typeof checkCv>> | null = null;
      if (kind === 'CV') {
        try {
          cvCheck = await checkCv(req.workerId!, { buffer: req.file!.buffer, mime: asset.mime, fileId: asset.id });
        } catch (err) {
          await deleteFileAsset(asset.id);
          throw err;
        }
        if (cvCheck.outcome === 'DECLINED') {
          await deleteFileAsset(asset.id); // not kept, not attached
          await audit(req, req.user!.id, 'worker.cv_declined', 'FileAsset', asset.id);
          throw mismatchError(cvCheck, 'cv');
        }
      }
      const oldId = await currentFileId(req.workerId!);
      await prisma.workerProfile.update({ where: { id: req.workerId! }, data: { [field]: asset.id } });
      await deleteFileAsset(oldId);
      await svc.recomputeCompletion(req.workerId!);
      await audit(req, req.user!.id, `worker.${path}_uploaded`, 'FileAsset', asset.id);
      // An accepted CV means the profile is trusted enough to be matched: find the open jobs that fit what the worker wants.
      const opportunities = cvCheck && cvCheck.outcome === 'ACCEPTED' ? await opportunitiesAfterAcceptance(req.workerId!, req.user!.id) : null;
      res.status(201).json({ profile: await svc.getOwnProfile(req.workerId!), ...(cvCheck ? { cvCheck, opportunities } : {}) });
    });
    router.delete(`/me/${path}`, ...mine, async (req, res) => {
      const oldId = await currentFileId(req.workerId!);
      await prisma.workerProfile.update({ where: { id: req.workerId! }, data: { [field]: null } });
      await deleteFileAsset(oldId);
      await svc.recomputeCompletion(req.workerId!);
      res.json({ profile: await svc.getOwnProfile(req.workerId!) });
    });
  }

  // Employers and admins may view a visible worker's public profile.
  router.get('/:id', requireAuth, requireRole('EMPLOYER', 'ADMIN'), async (req, res) => {
    const profile = await svc.getPublicProfile(idParam(req), req.user!.id);
    if (req.user!.role === 'EMPLOYER') await recordProfileView(profile.id, req.user!.id);
    res.json({ profile });
  });

  return router;
}
