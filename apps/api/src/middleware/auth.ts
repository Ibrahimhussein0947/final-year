import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { forbidden, passwordChangeRequired, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  role: Role;
  mustChangePassword?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: `${env.ACCESS_TTL_MIN}m`,
    algorithm: 'HS256',
  });
}

/**
 * Verifies an access token, then re-checks the account in the DB so suspensions apply immediately.
 * Also returns the token's expiry (seconds since epoch) so long-lived connections can be closed on time.
 */
export async function authenticateToken(token: string): Promise<AuthUser & { exp: number }> {
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.sub) throw new Error('bad token');
    payload = decoded;
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub! },
    select: { id: true, role: true, status: true, mustChangePassword: true },
  });
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Account is not active');
  return { id: user.id, role: user.role, mustChangePassword: user.mustChangePassword, exp: payload.exp ?? 0 };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const { id, role, mustChangePassword } = await authenticateToken(header.slice(7));
  // Until the temporary password is replaced, only the account endpoints (change password, log out, /me) work.
  if (mustChangePassword && !req.originalUrl.startsWith('/api/v1/auth/')) throw passwordChangeRequired();
  req.user = { id, role, mustChangePassword };
  next();
}

/** Attach req.user when a valid token is present; otherwise carry on anonymously. Never throws for bad tokens. */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization?.startsWith('Bearer ')) return next();
  try {
    await requireAuth(req, res, () => undefined);
  } catch {
    /* anonymous */
  }
  next();
}

/** Use after requireAuth. The returned function is named after the roles so the API reference can list them. */
export const requireRole = (...roles: Role[]) => {
  const check = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
  Object.defineProperty(check, 'name', { value: `requireRole:${roles.join('|')}` });
  return check;
};
