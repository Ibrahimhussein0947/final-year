import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { requireAuth } from '../../middleware/auth';
import { requireCsrfHeader, validateBody } from '../../middleware/common';
import * as svc from './service';
import * as account from './account';
import { deleteAccountSchema, totpCodeSchema, totpDisableSchema, changePasswordSchema, forgotPasswordSchema, loginSchema, otpRequestSchema, otpVerifySchema, registerSchema, resetPasswordSchema } from './schema';

const REFRESH_COOKIE = 'et_refresh';
const cookieOptions = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
};

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: env.REFRESH_TTL_DAYS * 86_400_000 });
}

export function authRouter(opts: { rateLimitMax?: number } = {}) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.rateLimitMax ?? (env.isTest ? 10_000 : 30),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
  });

  router.post('/register', limiter, validateBody(registerSchema), async (req, res) => {
    const { refreshToken, ...result } = await svc.register(req.body, req);
    setRefreshCookie(res, refreshToken);
    res.status(201).json(result);
  });

  router.post('/login', limiter, validateBody(loginSchema), async (req, res) => {
    const { refreshToken, ...result } = await svc.login(req.body, req);
    setRefreshCookie(res, refreshToken);
    res.json(result);
  });

  router.post('/refresh', requireCsrfHeader, async (req, res) => {
    try {
      const { refreshToken, ...result } = await svc.refresh(req.cookies?.[REFRESH_COOKIE], req);
      setRefreshCookie(res, refreshToken);
      res.json(result);
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw err;
    }
  });

  router.post('/logout', requireCsrfHeader, async (req, res) => {
    await svc.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: await svc.me(req.user!.id) });
  });

  router.post('/verify/request', requireAuth, limiter, validateBody(otpRequestSchema), async (req, res) => {
    res.json(await svc.requestOtp(req.user!.id, req.body.kind, req));
  });

  router.post('/verify/confirm', requireAuth, limiter, validateBody(otpVerifySchema), async (req, res) => {
    res.json({ user: await svc.verifyOtp(req.user!.id, req.body.kind, req.body.code, req) });
  });

  router.post('/password/forgot', limiter, validateBody(forgotPasswordSchema), async (req, res) => {
    res.json(await svc.requestPasswordReset(req.body.phone, req));
  });

  router.post('/password/reset', limiter, validateBody(resetPasswordSchema), async (req, res) => {
    res.json(await svc.resetPassword(req.body.phone, req.body.code, req.body.newPassword, req));
  });

  router.post('/password/change', requireAuth, limiter, validateBody(changePasswordSchema), async (req, res) => {
    const { refreshToken, accessToken } = await svc.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword, req);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken });
  });

  router.post('/2fa/setup', requireAuth, limiter, async (req, res) => {
    res.json(await svc.startTwoFactorSetup(req.user!.id, req));
  });
  router.post('/2fa/enable', requireAuth, limiter, validateBody(totpCodeSchema), async (req, res) => {
    const { backupCodes, ...user } = await svc.enableTwoFactor(req.user!.id, req.body.code, req);
    res.json({ user, backupCodes });
  });
  router.post('/2fa/disable', requireAuth, limiter, validateBody(totpDisableSchema), async (req, res) => {
    res.json({ user: await svc.disableTwoFactor(req.user!.id, req.body.password, req.body.code, req) });
  });

  router.get('/me/export', requireAuth, limiter, async (req, res) => {
    const data = await account.exportMyData(req.user!.id, req);
    res.setHeader('Content-Disposition', 'attachment; filename="my-ethiotalent-data.json"');
    res.json(data);
  });

  router.post('/me/delete', requireAuth, limiter, validateBody(deleteAccountSchema), async (req, res) => {
    const result = await account.deleteMyAccount(req.user!.id, req.body.password, req);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.json(result);
  });

  return router;
}
