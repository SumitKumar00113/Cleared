import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { acceptInvitation, authenticateUser, createWorkspaceAccount, getMembership } from './store.js';

export const authRouter = Router();
const sessions = new Map();
const SESSION_MS = 1000 * 60 * 60 * 12;
const cookieName = 'cleared_session';

function secret() { return process.env.SESSION_SECRET || process.env.JWT_SECRET || ''; }
function ready() { return secret().length >= 32; }
function sign(id) { return createHmac('sha256', secret()).update(id).digest('base64url'); }
function equalText(a = '', b = '') { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function cookieOptions() { return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function rawCookie(request) { return (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''; }
function attachCookie(response, user) {
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, { ...user, expires: Date.now() + SESSION_MS });
  response.setHeader('Set-Cookie', `${cookieName}=${id}.${sign(id)}; ${cookieOptions()}`);
}
export function readSession(request) {
  if (!ready()) return null;
  const [id, signature] = rawCookie(request).split('.');
  if (!id || !signature || !equalText(signature, sign(id))) return null;
  const session = sessions.get(id);
  if (!session || session.expires < Date.now()) { sessions.delete(id); return null; }
  const current = getMembership(session.workspaceId, session.userId);
  if (!current) { sessions.delete(id); return null; }
  Object.assign(session, current, { expires: Date.now() + SESSION_MS });
  return session;
}
function sessionUser(session) { return { id: session.userId, email: session.email, role: session.role, workspace: { id: session.workspaceId, name: session.workspaceName } }; }
function validateCredentials({ workspaceName, email, password }) {
  if (!workspaceName || workspaceName.trim().length < 2) return 'Enter a company or workspace name.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!password || password.length < 12) return 'Use a password with at least 12 characters.';
  return '';
}

authRouter.get('/session', (request, response) => {
  if (!ready()) return response.status(503).json({ error: 'Session signing is not configured. Set SESSION_SECRET or JWT_SECRET to at least 32 characters.' });
  const session = readSession(request);
  return response.json({ authenticated: Boolean(session), user: session ? sessionUser(session) : null });
});

authRouter.post('/workspaces', (request, response) => {
  if (!ready()) return response.status(503).json({ error: 'Session signing is not configured. Set SESSION_SECRET or JWT_SECRET to at least 32 characters.' });
  const input = { workspaceName: String(request.body?.workspaceName || ''), email: String(request.body?.email || ''), password: String(request.body?.password || '') };
  const validation = validateCredentials(input);
  if (validation) return response.status(400).json({ error: validation });
  try {
    const created = createWorkspaceAccount(input);
    attachCookie(response, created.user);
    return response.status(201).json({ authenticated: true, user: sessionUser(created.user) });
  } catch (error) {
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: 'An account with this email already exists.' });
    throw error;
  }
});

authRouter.post('/login', (request, response) => {
  if (!ready()) return response.status(503).json({ error: 'Session signing is not configured. Set SESSION_SECRET or JWT_SECRET to at least 32 characters.' });
  const account = authenticateUser(request.body?.email, request.body?.password);
  if (!account) return response.status(401).json({ error: 'The email or password is incorrect.' });
  const membership = getMembership(String(request.body?.workspaceId || ''), account.id);
  if (!membership) return response.status(403).json({ error: 'You do not belong to that workspace.' });
  attachCookie(response, membership);
  return response.json({ authenticated: true, user: sessionUser(membership) });
});

authRouter.post('/invitations/accept', (request, response) => {
  if (!ready()) return response.status(503).json({ error: 'Session signing is not configured.' });
  const input = { token: String(request.body?.token || ''), email: String(request.body?.email || ''), password: String(request.body?.password || '') };
  if (!input.token || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !input.password) return response.status(400).json({ error: 'Use the invited email address and enter a password.' });
  const result = acceptInvitation(input);
  if (result.error) return response.status(400).json({ error: result.error });
  attachCookie(response, result.user);
  return response.status(201).json({ authenticated: true, user: sessionUser(result.user) });
});

authRouter.post('/logout', (request, response) => {
  const id = rawCookie(request).split('.')[0];
  if (id) sessions.delete(id);
  response.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return response.json({ authenticated: false });
});

export function requireAuth(request, response, next) {
  if (!ready()) return response.status(503).json({ error: 'Session signing is not configured. Set SESSION_SECRET or JWT_SECRET to at least 32 characters.' });
  const session = readSession(request);
  if (!session) return response.status(401).json({ error: 'Sign in to continue.' });
  request.user = session;
  return next();
}

export function requireRole(roles) {
  return (request, response, next) => roles.includes(request.user?.role) ? next() : response.status(403).json({ error: 'Your workspace role cannot perform this action.' });
}
