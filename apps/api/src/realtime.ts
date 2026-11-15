import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from './config/env';
import { logger } from './lib/logger';
import { authenticateToken } from './middleware/auth';

/**
 * Real-time push over Socket.IO. The API stays the source of truth: every event is also stored (notifications,
 * messages), so a missed push is never a lost message; clients simply refetch when they reconnect.
 *
 * Security: a connection must present a valid access token in `auth.token`; each user joins only their own
 * room, so events can never reach anyone else; the server closes the connection when the token expires (the
 * client reconnects with a fresh one); clients cannot publish events, they use the REST API.
 */
let io: Server | null = null;

export function attachRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
    maxHttpBufferSize: 10_000,
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string' || !token) return next(new Error('unauthorized'));
      const user = await authenticateToken(token);
      socket.data.userId = user.id;
      socket.data.exp = user.exp;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId}`);
    const ms = Math.max(1000, socket.data.exp * 1000 - Date.now());
    const timer = setTimeout(() => socket.disconnect(true), ms);
    socket.on('disconnect', () => clearTimeout(timer));
  });
  logger.info('realtime (Socket.IO) attached');
  return io;
}

/** Send an event to every open connection of one user. Does nothing when realtime is not attached. */
export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Close every open connection of a user (used when an account is suspended). */
export function disconnectUser(userId: string) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

export async function closeRealtime() {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise<void>((resolve) => void server.close(() => resolve()));
}
