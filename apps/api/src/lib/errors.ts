export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const tooMany = (message = 'Too many attempts, try again later') => new AppError(429, 'RATE_LIMITED', message);
export const passwordChangeRequired = () => new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must choose a new password before continuing');
export const twoFactorRequired = () => new AppError(401, 'TWO_FACTOR_REQUIRED', 'Enter the 6-digit code from your authenticator app');
