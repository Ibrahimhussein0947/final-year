import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { forbidden, notFound } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { filePathOf } from './storage';
import { employerMayReadCv } from '../applications/service';

/**
 * Downloads go through authorization; uploaded files are never served statically.
 * - Profile photos: any signed-in user.
 * - Everything else (CVs, evidence, certificates): the owner or an admin.
 *   (Employers get access to a CV only after an application exists; added with applications in Phase 7.)
 */
export function filesRouter() {
  const router = Router();

  router.get('/:id', requireAuth, async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound();
    const file = await prisma.fileAsset.findUnique({ where: { id: id.data } });
    if (!file) throw notFound();
    const allowed =
      file.kind === 'PROFILE_PHOTO' ||
      file.ownerId === req.user!.id ||
      req.user!.role === 'ADMIN' ||
      // Employers may read a CV or a supporting document only while its owner has an active application to one of their jobs.
      ((file.kind === 'CV' || file.kind === 'CERTIFICATE') && req.user!.role === 'EMPLOYER' && (await employerMayReadCv(req.user!.id, file.id)));
    if (!allowed) throw forbidden();
    res
      .set({
        'Content-Type': file.mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': file.kind === 'PROFILE_PHOTO' ? 'inline' : 'attachment',
        'Cache-Control': 'private, max-age=300',
      })
      .sendFile(filePathOf(file.storagePath));
  });

  return router;
}
