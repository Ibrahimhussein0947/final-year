import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { logger } from '../lib/logger';

/** Parse and replace req.body with the validated, typed value. */
export const validateBody =
  (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw badRequest('Validation failed', result.error.flatten().fieldErrors);
    }
    req.body = result.data;
    next();
  };

/** Cookie-based endpoints require a custom header, which browsers only send same-origin or after a CORS preflight. */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-csrf-protection') !== '1') throw forbidden('Missing CSRF protection header');
  next();
}

export function notFoundHandler(_req: Request, _res: Response) {
  throw notFound('Route not found');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Validation failed', details: err.flatten().fieldErrors } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Resource already exists' } });
    return;
  }
  if (err instanceof MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: { code: tooBig ? 'FILE_TOO_LARGE' : 'BAD_UPLOAD', message: tooBig ? 'File is too large' : 'Invalid upload' } });
    return;
  }
  // body-parser errors (malformed JSON, payload too large)
  const status = (err as { status?: number })?.status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
