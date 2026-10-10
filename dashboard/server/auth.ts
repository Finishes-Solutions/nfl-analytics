/**
 * auth.ts — single-user access control.
 *
 * In Azure, sign-in is done by App Service Authentication ("Easy Auth",
 * Microsoft identity provider) in front of the app — no auth code to maintain.
 * Easy Auth injects X-MS-CLIENT-PRINCIPAL-NAME on authenticated requests and
 * strips any client-supplied copy, and App Service sets WEBSITE_AUTH_ENABLED
 * when it is on. This middleware:
 *   - refuses everything if Easy Auth is not enabled (so the header can't be
 *     forged against an unprotected app), unless AUTH_DISABLED=true (local dev);
 *   - optionally pins access to ALLOWED_EMAILS.
 */
import type { Request, Response, NextFunction } from 'express';

const authDisabled = process.env.AUTH_DISABLED === 'true';
const allowed = (process.env.ALLOWED_EMAILS ?? '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function authMode(): string {
  if (authDisabled) return 'DISABLED (local only)';
  return `App Service Authentication${allowed.length ? `, allowlist of ${allowed.length}` : ''}`;
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (authDisabled) return next();
  if (String(process.env.WEBSITE_AUTH_ENABLED ?? '').toLowerCase() !== 'true') {
    res.status(503).json({
      error: 'App Service Authentication is not enabled. Turn it on (Authentication → Add identity provider → Microsoft) or set AUTH_DISABLED=true for local development.',
    });
    return;
  }
  const user = String(req.header('x-ms-client-principal-name') ?? '').toLowerCase();
  if (!user) { res.status(401).json({ error: 'not signed in' }); return; }
  if (allowed.length && !allowed.includes(user)) {
    console.warn(`AUTH REJECT: ${user} not in ALLOWED_EMAILS`);
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}
