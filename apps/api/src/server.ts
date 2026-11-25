import http from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { attachRealtime, closeRealtime } from './realtime';
import { startReminderLoop } from './modules/applications/interviews';
import { startOfferLoop } from './modules/offers/service';
import { startJobCloseLoop } from './modules/hiring/availability';

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);
server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
startReminderLoop();
startOfferLoop();
startJobCloseLoop();

async function shutdown() {
  await closeRealtime();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
