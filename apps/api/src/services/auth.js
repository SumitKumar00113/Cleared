import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { acceptInvitation, authenticateUser, checkAuthLimit, clearAuthFailures, consumeRequestLimit, createSession, createWorkspaceAccount, getMembership, getSession, isCommonPassword, listActiveSessions, recordAuthFailure, revokeListedSession, revokeSession, revokeUserSessions } from './store.js';

export const authRouter = Router();
const SESSION_MS = 1000 * 60 * 60 * 12;
const cookieName = 'cleared_session';
const csrfCookieName = 'cleared_csrf';
function secret() { return process.env.SESSION_SECRET || ''; }
function ready() { return secret().length >= 32; }
function sign(id) { return createHmac('sha256', secret()).update(id).digest('base64url'); }
function equalText(a = '', b = '') { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function cookieOptions() { return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function csrfCookieOptions() { return `Path=/; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function cookie(request, name) { return (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function rawCookie(request) { return cookie(request, cookieName); }
function attachCookie(response, user, request) {
  const id = randomBytes(32).toString('base64url');
  createSession({ id, userId: user.userId, workspaceId: user.workspaceId, userAgent: request.get('user-agent') || '' });
  response.setHeader('Set-Cookie', [`${cookieName}=${id}.${sign(id)}; ${cookieOptions()}`, `${csrfCookieName}=${randomBytes(32).toString('base64url')}; ${csrfCookieOptions()}`]);
}
export function readSession(request) {
  if (!ready()) return null;
  const [id, signature] = rawCookie(request).split('.');
  if (!id || !signature || !equalText(signature, sign(id))) return null;
  return getSession(id);
}
function sessionUser(session) { return { id: session.userId, email: session.email, role: session.role, workspace: { id: session.workspaceId, name: session.workspaceName } }; }
function validateCredentials({ workspaceName, email, password }) {
  if (!workspaceName || workspaceName.trim().length < 2) return 'Enter a company or workspace name.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!password || password.length < 12) return 'Use a password with at least 12 characters.';
  if (isCommonPassword(password)) return 'Choose a less common password with at least 12 characters.';
  return '';
}
function authKeys(request, email) {
  const ip = String(request.ip || request.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  const account = createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
  const address = createHash('sha256').update(ip).digest('hex');
  return [`account:${account}`, `ip:${address}`, `pair:${account}:${address}`];
}
function rateLimited(request, response, next) {
  const email = request.body?.email || '';
  const keys = authKeys(request, email);
  const accountKeys = keys.filter((key) => !key.startsWith('ip:'));
  const wait = Math.max(consumeRequestLimit(accountKeys, 12, 15 * 60 * 1000), consumeRequestLimit(keys.filter((key) => key.startsWith('ip:')), 60, 15 * 60 * 1000), checkLimit(accountKeys));
  if (!wait) return next();
  response.setHeader('Retry-After', String(wait));
  return response.status(429).json({ error: 'Unable to complete this request right now. Try again later.' });
}
function checkLimit(keys) { return checkAuthLimit(keys); }
export function authRateLimit(request, response, next) {
  const keys = authKeys(request, request.user?.email || request.body?.email);
  const wait = consumeRequestLimit(keys, 12, 15 * 60 * 1000);
  if (!wait) return next();
  response.setHeader('Retry-After', String(wait));
  return response.status(429).json({ error: 'Unable to complete this request right now. Try again later.' });
}

authRouter.get('/csrf', (request, response) => {
  let token = cookie(request, csrfCookieName);
  if (!token) { token = randomBytes(32).toString('base64url'); response.append('Set-Cookie', `${csrfCookieName}=${token}; ${csrfCookieOptions()}`); }
  return response.json({ token });
});
authRouter.get('/session', (request, response) => {
  if (!ready()) return response.status(503).json({ error: 'Authentication service is not configured.' });
  const session = readSession(request);
  return response.json({ authenticated: Boolean(session), user: session ? sessionUser(session) : null });
});
authRouter.post('/workspaces', async (request, response, next) => {
  if (!ready()) return response.status(503).json({ error: 'Authentication service is not configured.' });
  const input = { workspaceName: String(request.body?.workspaceName || ''), email: String(request.body?.email || ''), password: String(request.body?.password || '') };
  const validation = validateCredentials(input);
  if (validation) return response.status(400).json({ error: validation });
  try {
    const created = await createWorkspaceAccount(input);
    attachCookie(response, created.user, request);
    return response.status(201).json({ authenticated: true, user: sessionUser(created.user) });
  } catch (error) { if (String(error.code).startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: 'Could not create this account.' }); return next(error); }
});
authRouter.post('/login', rateLimited, async (request, response, next) => {
  if (!ready()) return response.status(503).json({ error: 'Authentication service is not configured.' });
  const keys = authKeys(request, request.body?.email);
  try {
    const account = await authenticateUser(request.body?.email, request.body?.password);
    const membership = account && getMembership(String(request.body?.workspaceId || ''), account.id);
    if (!account || !membership) { recordAuthFailure(keys.filter((key) => !key.startsWith('ip:'))); return response.status(401).json({ error: 'The email, password, or workspace is incorrect.' }); }
    clearAuthFailures(keys.filter((key) => !key.startsWith('ip:')));
    attachCookie(response, membership, request);
    return response.json({ authenticated: true, user: sessionUser(membership) });
  } catch (error) { return next(error); }
});
authRouter.post('/invitations/accept', rateLimited, async (request, response, next) => {
  if (!ready()) return response.status(503).json({ error: 'Authentication service is not configured.' });
  const input = { token: String(request.body?.token || ''), email: String(request.body?.email || ''), password: String(request.body?.password || '') };
  const keys = authKeys(request, input.email);
  if (!input.token || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !input.password) { recordAuthFailure(keys.filter((key) => !key.startsWith('ip:'))); return response.status(400).json({ error: 'The invitation details are invalid or expired.' }); }
  try {
    const result = await acceptInvitation(input);
    if (result.error) { recordAuthFailure(keys.filter((key) => !key.startsWith('ip:'))); return response.status(400).json({ error: 'The invitation details are invalid or expired.' }); }
    clearAuthFailures(keys.filter((key) => !key.startsWith('ip:')));
    attachCookie(response, result.user, request);
    return response.status(201).json({ authenticated: true, user: sessionUser(result.user) });
  } catch (error) { return next(error); }
});
authRouter.get('/sessions', requireAuth, (request, response) => response.json({ data: listActiveSessions(request.user.userId) }));
authRouter.delete('/sessions/:sessionId', requireAuth, (request, response) => {
  const revoked = revokeListedSession(request.user.userId, request.params.sessionId);
  return revoked ? response.json({ revoked: true }) : response.status(404).json({ error: 'Session not found.' });
});
authRouter.post('/logout', (request, response) => {
  const id = rawCookie(request).split('.')[0];
  if (id) revokeSession(id);
  response.setHeader('Set-Cookie', [`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`, `${csrfCookieName}=; Path=/; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`]);
  return response.json({ authenticated: false });
});
authRouter.post('/logout-everywhere', requireAuth, (request, response) => {
  revokeUserSessions(request.user.userId);
  response.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return response.json({ authenticated: false, revoked: true });
});

export function requireAuth(request, response, next) {
  if (!ready()) return response.status(503).json({ error: 'Authentication service is not configured.' });
  const session = readSession(request);
  if (!session) return response.status(401).json({ error: 'Sign in to continue.' });
  request.user = session;
  return next();
}
export function requireRole(roles) { return (request, response, next) => roles.includes(request.user?.role) ? next() : response.status(403).json({ error: 'Your workspace role cannot perform this action.' }); }
export function csrfProtection(request, response, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.path !== '/auth/csrf') {
    const provided = request.get('x-csrf-token') || '';
    const stored = cookie(request, csrfCookieName);
    if (!provided || !stored || !equalText(provided, stored)) return response.status(403).json({ error: 'Request verification failed. Refresh the page and try again.' });
  }
  next();
}
