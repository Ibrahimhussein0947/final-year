import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  // LOG_LEVEL overrides the default (tests are silent), e.g. LOG_LEVEL=error npm test to see unhandled errors.
  level: process.env.LOG_LEVEL ?? (env.isTest ? 'silent' : env.isProd ? 'info' : 'debug'),
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  transport: env.isProd || env.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
