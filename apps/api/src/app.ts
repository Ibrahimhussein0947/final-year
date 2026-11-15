import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/common';
import { authRouter } from './modules/auth/routes';
import { taxonomyRouter } from './modules/taxonomy/routes';
import { criteriaRouter } from './modules/criteria/routes';
import { talentRouter } from './modules/talent/routes';
import { organizationTypesRouter } from './modules/hiring/directory';
import { workersRouter } from './modules/workers/routes';
import { employersRouter } from './modules/employers/routes';
import { filesRouter } from './modules/files/routes';
import { jobsRouter } from './modules/jobs/routes';
import { interviewsRouter } from './modules/applications/interviews';
import { trainingAdminRouter, trainingRouter } from './modules/training/routes';
import { savedSearchesRouter } from './modules/jobs/savedSearches';
import { applicationsRouter } from './modules/applications/routes';
import { matchingRouter } from './modules/matching/routes';
import { analysisRouter } from './modules/analysis/routes';
import { messagingRouter } from './modules/messaging/routes';
import { trustRouter } from './modules/trust/routes';
import { adminRouter } from './modules/admin/routes';
import { notificationsRouter } from './modules/notifications/routes';

export function createApp(opts: { authRateLimitMax?: number } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Nginx in production

  app.use(pinoHttp({ logger, autoLogging: !env.isTest }));
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Protection'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/auth', authRouter({ rateLimitMax: opts.authRateLimitMax }));
  app.use('/api/v1', taxonomyRouter());
  app.use('/api/v1', criteriaRouter());
  app.use('/api/v1', talentRouter());
  app.use('/api/v1', organizationTypesRouter());
  app.use('/api/v1/workers', workersRouter());
  app.use('/api/v1/employers', employersRouter());
  app.use('/api/v1/files', filesRouter());
  app.use('/api/v1/interviews', interviewsRouter());
  app.use('/api/v1/saved-searches', savedSearchesRouter());
  app.use('/api/v1/jobs', jobsRouter());
  app.use('/api/v1', applicationsRouter());
  app.use('/api/v1', matchingRouter());
  app.use('/api/v1', analysisRouter());
  app.use('/api/v1', messagingRouter());
  app.use('/api/v1', trustRouter());
  app.use('/api/v1/admin/training', trainingAdminRouter());
  app.use('/api/v1/training', trainingRouter());
  app.use('/api/v1/admin', adminRouter());
  app.use('/api/v1/notifications', notificationsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
