import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { acceptInvitation, activateMfa, authenticateUser, changeVerifiedEmail, checkAuthLimit, clearAuthFailures, clearAuthFailuresForAccount, completeMfaChallenge, consumeActionToken, consumeRequestLimit, consumeTotpStep, createActionToken, createMfaChallenge, createSession, createWorkspaceAccount, derivePasswordCredentials, getActionToken, getMfaChallenge, getMembership, getMfaUser, getSession, getUserByEmail, getUserById, getUserWorkspaces, invalidateOtherPasswordResetTokens, isCommonPassword, listActiveSessions, markSessionRecentlyAuthenticated, recordAuthFailure, recordAuditEvent, revokeListedSession, revokeSession, revokeUserSessions, savePendingMfaSecret, setEmailVerified, updatePassword } from './store.js';
import { sendMail } from './mailer.js';
import { decryptTotpSecret, encryptTotpSecret, enrollmentUri, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, matchingTotpStep } from './mfa.js';

export const authRouter = Router();
const SESSION_MS = 1000 * 60 * 60 * 12;
const cookieName = () => process.env.NODE_ENV === 'production' ? '__Host-cleared_session' : 'cleared_session';
const csrfCookieName = 'cleared_csrf';
function secret() { return process.env.SESSION_SECRET || ''; }
function ready() { return secret().length >= 32; }
function sign(id) { return createHmac('sha256', secret()).update(id).digest('base64url'); }
function csrfSignature(token) { return createHmac('sha256', secret()).update(`csrf:${token}`).digest('base64url'); }
function sessionCsrfToken(id) { return createHmac('sha256', secret()).update(`csrf-session:${id}`).digest('base64url'); }
function equalText(a = '', b = '') { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function cookieOptions() { return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function csrfCookieOptions() { return `Path=/; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function cookie(request, name) { return (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function rawCookie(request) { return cookie(request, cookieName()); }
function clearSessionCookie(response) { response.append('Set-Cookie', `${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function attachCookie(response, user, request, { mfaVerified = false } = {}) {
  const previous = rawCookie(request).split('.')[0];
  if (previous) revokeSession(previous);
  const id = randomBytes(32).toString('base64url');
  createSession({ id, userId: user.userId, workspaceId: user.workspaceId, userAgent: request.get('user-agent') || '', mfaVerified });
  const csrfToken = sessionCsrfToken(id);
  response.setHeader('Set-Cookie', [`${cookieName()}=${id}.${sign(id)}; ${cookieOptions()}`, `${csrfCookieName}=${csrfToken}.${csrfSignature(csrfToken)}; ${csrfCookieOptions()}`]);
}
export function readSession(request) {
  if (!ready()) return null;
  const [id, signature] = rawCookie(request).split('.');
  if (!id || !signature || !equalText(signature, sign(id))) return null;
  return getSession(id, { touch: !['GET', 'HEAD', 'OPTIONS'].includes(request.method) });
}
const MFA_ROLES = new Set(['owner', 'administrator', 'brand_manager', 'reviewer']);
function requiresMfa(role) { return MFA_ROLES.has(role); }
function sessionUser(session) { return { id: session.userId, email: session.email, emailVerified: Boolean(session.emailVerified), role: session.role, mfaEnabled: Boolean(session.mfaEnabled), mfaVerified: Boolean(session.mfaVerified), mfaSetupRequired: requiresMfa(session.role) && !session.mfaEnabled, workspace: { id: session.workspaceId, name: session.workspaceName } }; }
function validateCredentials({ workspaceName, email, password }) {
  if (!workspaceName || workspaceName.trim().length < 2) return 'Enter a company or workspace name.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!password || password.length < 12) return 'Use a password with at least 12 characters.';
  if (isCommonPassword(password)) return 'Choose a less common password with at least 12 characters.';
  return '';
}
function applicationBase(request) { return String(process.env.APP_BASE_URL || request.get('origin') || `${request.protocol}://${request.get('host')}`).replace(/\/$/, ''); }
function actionUrl(request, page, token) { return `${applicationBase(request)}/${page}?token=${encodeURIComponent(token)}`; }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')); }
function mailFailure(error) {
  const details = {
    name: String(error?.name || 'Error').slice(0, 40),
    code: error?.code ? String(error.code).slice(0, 40) : undefined,
    responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined,
    command: error?.command ? String(error.command).slice(0, 40) : undefined,
    detail: error?.detail ? String(error.detail).slice(0, 80) : undefined,
  };
  console.error('Email delivery failed:', JSON.stringify(details));
}
function authKeys(request, email) {
  const ip = String(request.ip || request.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  const account = createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
  const address = createHash('sha256').update(ip).digest('hex');
  return [`ip:${address}`, `pair:${account}:${address}`];
}
function requestKeys(request, keys) { const route=`${request.baseUrl || ''}${request.path || ''}`; return keys.map((key)=>`${key}:route:${route}`); }
function rateLimited(request, response, next) {
  const email = request.body?.email || '';
  const keys = authKeys(request, email);
  const pairKeys = keys.filter((key) => key.startsWith('pair:'));
  const limitedKeys=requestKeys(request,keys); const wait = Math.max(consumeRequestLimit(limitedKeys.filter((key) => key.startsWith('pair:')), 12, 15 * 60 * 1000), consumeRequestLimit(limitedKeys.filter((key) => key.startsWith('ip:')), 60, 15 * 60 * 1000), checkLimit(pairKeys));
  if (!wait) return next();
  const account=getUserByEmail(email);
  const membership=account&&request.body?.workspaceId?getMembership(String(request.body.workspaceId),account.id):null;
  if(membership)recordAuditEvent({workspaceId:membership.workspaceId,actorId:membership.userId,action:'auth.lockout',targetType:'account',targetId:membership.userId,details:{route:request.path}});
  response.setHeader('Retry-After', String(wait));
  return response.status(429).json({ error: 'Unable to complete this request right now. Try again later.' });
}
function checkLimit(keys) { return checkAuthLimit(keys); }
export function authRateLimit(request, response, next) {
  const keys = authKeys(request, request.user?.email || request.body?.email);
  const limitedKeys=requestKeys(request,keys); const wait = Math.max(consumeRequestLimit(limitedKeys.filter((key) => key.startsWith('pair:')), 12, 15 * 60 * 1000), consumeRequestLimit(limitedKeys.filter((key) => key.startsWith('ip:')), 60, 15 * 60 * 1000));
  if (!wait) return next();
  if(request.user)recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'auth.lockout',targetType:'account',targetId:request.user.userId,details:{route:request.path}});
  response.setHeader('Retry-After', String(wait));
  return response.status(429).json({ error: 'Unable to complete this request right now. Try again later.' });
}

authRouter.get('/csrf', (request, response) => {
  let token = cookie(request, csrfCookieName);
  const sessionId = rawCookie(request).split('.')[0];
  if (sessionId && equalText(cookie(request, csrfCookieName), `${sessionCsrfToken(sessionId)}.${csrfSignature(sessionCsrfToken(sessionId))}`)) token = cookie(request, csrfCookieName);
  else if (sessionId && equalText(sign(sessionId), rawCookie(request).split('.')[1])) {
    const csrfToken = sessionCsrfToken(sessionId);
    token = `${csrfToken}.${csrfSignature(csrfToken)}`;
    response.append('Set-Cookie', `${csrfCookieName}=${token}; ${csrfCookieOptions()}`);
  } else {
    const [preAuthToken, signature] = token.split('.');
    if (!preAuthToken || !signature || !equalText(signature, csrfSignature(preAuthToken))) {
      const preAuth = randomBytes(32).toString('base64url');
      token = `${preAuth}.${csrfSignature(preAuth)}`;
      response.append('Set-Cookie', `${csrfCookieName}=${token}; ${csrfCookieOptions()}`);
    }
  }
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
    const verifyToken = createActionToken({ userId: created.user.userId, kind: 'email_verify', ttlMs: 24 * 60 * 60 * 1000 });
    let emailSent = true;
    try { await sendMail({ to: created.user.email, subject: 'Verify your Cleared email', text: `Verify your email to open your workspace: ${actionUrl(request, 'verify-email', verifyToken)}` }); }
    catch (error) { emailSent = false; mailFailure(error); }
    attachCookie(response, created.user, request);
    return response.status(201).json({ authenticated: true, user: sessionUser(created.user), verificationEmailSent: emailSent });
  } catch (error) {
    const sqliteConstraint = String(error.code).startsWith('SQLITE_CONSTRAINT') || (Number.isInteger(error.errcode) && (error.errcode & 0xff) === 19);
    if (sqliteConstraint) return response.status(409).json({ error: 'Could not create this account.' });
    return next(error);
  }
});
authRouter.post('/login', rateLimited, async (request, response, next) => {
  if (!ready()) return response.status(503).json({ error: 'Authentication service is not configured.' });
  const keys = authKeys(request, request.body?.email);
  try {
    const account = await authenticateUser(request.body?.email, request.body?.password);
    const membership = account && getMembership(String(request.body?.workspaceId || ''), account.id);
    if (!account || !membership) { recordAuthFailure(keys.filter((key) => !key.startsWith('ip:'))); const knownUser=getUserByEmail(request.body?.email); const attempted=String(request.body?.workspaceId||''); const failedWorkspace=knownUser?getMembership(attempted,knownUser.id)?.workspaceId:null; recordAuditEvent({workspaceId:failedWorkspace||null,actorId:knownUser?.id||null,action:'auth.sign_in_failed',targetType:'account',targetId:knownUser?.id||null,requestOrigin:request.get('origin')||request.get('referer')||null}); return response.status(401).json({ error: 'The email, password, or workspace is incorrect.' }); }
    clearAuthFailures(keys.filter((key) => !key.startsWith('ip:')));
    if (!membership.emailVerified) {
      clearSessionCookie(response);
      return response.json({ authenticated: false, verificationRequired: true, email: membership.email });
    }
    if (membership.mfaEnabled) {
      recordAuditEvent({workspaceId:membership.workspaceId,actorId:membership.userId,action:'auth.sign_in',targetType:'session',targetId:null,requestOrigin:request.get('origin')||request.get('referer')||null,details:{mfaRequired:true}});
      const challengeToken = randomBytes(32).toString('base64url');
      createMfaChallenge({ token: challengeToken, userId: membership.userId, workspaceId: membership.workspaceId, userAgent: request.get('user-agent') || '' });
      clearSessionCookie(response);
      return response.json({ authenticated: false, mfaRequired: true, challengeToken, email: membership.email });
    }
    attachCookie(response, membership, request);
    recordAuditEvent({workspaceId:membership.workspaceId,actorId:membership.userId,action:'auth.sign_in',targetType:'session',targetId:null,requestOrigin:request.get('origin')||request.get('referer')||null});
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
    recordAuditEvent({workspaceId:result.user.workspaceId,actorId:result.user.userId,action:'invitation.accepted',targetType:'member',targetId:result.user.userId,requestOrigin:request.get('origin')||request.get('referer')||null});
    if (result.user.mfaEnabled) {
      const challengeToken = randomBytes(32).toString('base64url');
      createMfaChallenge({ token: challengeToken, userId: result.user.userId, workspaceId: result.user.workspaceId, userAgent: request.get('user-agent') || '' });
      return response.status(201).json({ authenticated: false, mfaRequired: true, challengeToken, email: result.user.email });
    }
    attachCookie(response, result.user, request);
    return response.status(201).json({ authenticated: true, user: sessionUser(result.user) });
  } catch (error) { return next(error); }
});
authRouter.post('/email/resend', authRateLimit, async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const user = isEmail(email) ? getUserByEmail(email) : null;
  if (user && !user.email_verified) {
    const token = createActionToken({ userId: user.id, kind: 'email_verify', ttlMs: 24 * 60 * 60 * 1000 });
    try { await sendMail({ to: user.email, subject: 'Verify your Cleared email', text: `Verify your email to open your workspace: ${actionUrl(request, 'verify-email', token)}` }); }
    catch (error) { mailFailure(error); }
  }
  return response.status(202).json({ message: 'If the account needs verification, an email will be sent.' });
});
authRouter.post('/email/verify', authRateLimit, async (request, response) => {
  const token = String(request.body?.token || '');
  const unlock = getActionToken(token, 'account_unlock');
  if (unlock) {
    const account = getUserById(unlock.user_id);
    const consumed = account && consumeActionToken(token, 'account_unlock', (row) => clearAuthFailuresForAccount(account.email));
    return consumed ? response.json({ unlocked: true }) : response.status(400).json({ error: 'This email link is invalid or expired.' });
  }
  const verification = getActionToken(token, 'email_verify');
  if (verification) {
    const consumed = consumeActionToken(token, 'email_verify', (row) => setEmailVerified(row.user_id));
    return consumed ? response.json({ verified: true }) : response.status(400).json({ error: 'This email link is invalid or expired.' });
  }
  const change = getActionToken(token, 'email_change');
  const user = change && getUserById(change.user_id);
  if (!change || !user || !change.target_email || getUserByEmail(change.target_email)) return response.status(400).json({ error: 'This email link is invalid or expired.' });
  let oldEmail = user.email;
  const consumed = consumeActionToken(token, 'email_change', (row) => { oldEmail = getUserById(row.user_id).email; changeVerifiedEmail(row.user_id, row.target_email); });
  if (!consumed) return response.status(400).json({ error: 'This email link is invalid or expired.' });
  for(const workspace of getUserWorkspaces(change.user_id))recordAuditEvent({workspaceId:workspace.id,actorId:change.user_id,action:'auth.email_changed',targetType:'account',targetId:change.user_id});
  try { await sendMail({ to: oldEmail, subject: 'Your Cleared email was changed', text: `The email on your Cleared account was changed to ${change.target_email}. If you did not request this, contact your workspace administrator.` }); }
  catch (error) { mailFailure(error); }
  return response.json({ verified: true, emailChanged: true, email: change.target_email });
});
authRouter.post('/account/unlock', authRateLimit, async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const user = isEmail(email) ? getUserByEmail(email) : null;
  if (user?.email_verified) {
    const token = createActionToken({ userId: user.id, kind: 'account_unlock', ttlMs: 15 * 60 * 1000 });
    try { await sendMail({ to: user.email, subject: 'Unlock your Cleared sign-in', text: `Use this link within 15 minutes to clear sign-in lockouts: ${actionUrl(request, 'verify-email', token)}` }); }
    catch (error) { mailFailure(error); }
  }
  return response.status(202).json({ message: 'If the account is eligible, an unlock link will be sent.' });
});
authRouter.post('/password/forgot', authRateLimit, async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const user = isEmail(email) ? getUserByEmail(email) : null;
  if (user) {
    const token = createActionToken({ userId: user.id, kind: 'password_reset', ttlMs: 30 * 60 * 1000 });
    try { await sendMail({ to: user.email, subject: 'Reset your Cleared password', text: `Reset your password within 30 minutes: ${actionUrl(request, 'reset-password', token)}` }); }
    catch (error) { mailFailure(error); }
  }
  return response.status(202).json({ message: 'If an account matches that email, password reset instructions will be sent.' });
});
authRouter.post('/password/reset', rateLimited, async (request, response) => {
  const token = String(request.body?.token || '');
  const email = String(request.body?.email || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  const failureKeys = authKeys(request, email).filter((key) => key.startsWith('pair:'));
  if (password.length < 12 || isCommonPassword(password)) return response.status(400).json({ error: 'Choose a less common password with at least 12 characters.' });
  const action = getActionToken(token, 'password_reset');
  const user = action && getUserById(action.user_id);
  if (!user || user.email !== email) { recordAuthFailure(failureKeys); return response.status(400).json({ error: 'This password reset link is invalid or expired.' }); }
  const credentials = await derivePasswordCredentials(password);
  const consumed = consumeActionToken(token, 'password_reset', (row) => {
    updatePassword(row.user_id, credentials);
    invalidateOtherPasswordResetTokens(row.user_id, row.id);
    clearAuthFailuresForAccount(user.email);
  });
  if (!consumed) { recordAuthFailure(failureKeys); return response.status(400).json({ error: 'This password reset link is invalid or expired.' }); }
  clearAuthFailures(failureKeys);
  for(const workspace of getUserWorkspaces(user.id))recordAuditEvent({workspaceId:workspace.id,actorId:user.id,action:'auth.password_reset',targetType:'account',targetId:user.id});
  return response.json({ reset: true });
});
authRouter.post('/email/change', requireAuth, authRateLimit, async (request, response, next) => {
  const currentPassword = String(request.body?.currentPassword || '');
  const newEmail = String(request.body?.newEmail || '').trim().toLowerCase();
  if (!request.user.emailVerified) return response.status(403).json({ error: 'Verify your current email first.' });
  if (!isEmail(newEmail) || newEmail === request.user.email) return response.status(400).json({ error: 'Enter a different valid email address.' });
  try {
    const verified = await authenticateUser(request.user.email, currentPassword);
    if (!verified || getUserByEmail(newEmail)) return response.status(400).json({ error: 'Could not start this email change.' });
    const token = createActionToken({ userId: request.user.userId, kind: 'email_change', targetEmail: newEmail, ttlMs: 24 * 60 * 60 * 1000 });
    const verifyLink = actionUrl(request, 'verify-email', token);
    try {
      await sendMail({ to: newEmail, subject: 'Confirm your Cleared email change', text: `Confirm this email address within 24 hours: ${verifyLink}` });
      await sendMail({ to: request.user.email, subject: 'Cleared email change requested', text: `A request was made to change the email on your Cleared account. If this was not you, reset your password and contact your administrator.` });
    } catch (error) { mailFailure(error); return response.status(503).json({ error: 'Could not send the email change messages. Please try again.' }); }
    recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'auth.email_change_requested',targetType:'account',targetId:request.user.userId,requestOrigin:request.get('origin')||request.get('referer')||null});
    return response.status(202).json({ message: 'Check the new address to confirm the change.' });
  } catch (error) { return next(error); }
});
authRouter.post('/mfa/challenge', rateLimited, (request, response) => {
  const token = String(request.body?.challengeToken || '');
  const email = String(request.body?.email || '').trim().toLowerCase();
  const keys = authKeys(request, email).filter((key) => key.startsWith('pair:'));
  const challenge = getMfaChallenge(token);
  if (!challenge || challenge.email !== email) { recordAuthFailure(keys); if(challenge)recordAuditEvent({workspaceId:challenge.workspaceId,actorId:challenge.userId,action:'mfa.challenge_failed',targetType:'user',targetId:challenge.userId}); return response.status(401).json({ error: 'The verification code or recovery code is incorrect.' }); }
  let completed;
  if (request.body?.recoveryCode) completed = completeMfaChallenge(token, { recoveryHash: hashRecoveryCode(request.body.recoveryCode) });
  else {
    const secret = decryptTotpSecret(challenge.secretEncrypted);
    const step = matchingTotpStep(secret, request.body?.code, Date.now(), challenge.lastStep);
    completed = step === null ? null : completeMfaChallenge(token, { step });
  }
  if (!completed) { recordAuthFailure(keys); recordAuditEvent({workspaceId:challenge.workspaceId,actorId:challenge.userId,action:'mfa.challenge_failed',targetType:'user',targetId:challenge.userId}); return response.status(401).json({ error: 'The verification code or recovery code is incorrect.' }); }
  clearAuthFailures(keys);
  const user = getMembership(completed.workspaceId, completed.userId);
  attachCookie(response, user, request, { mfaVerified: true });
  recordAuditEvent({workspaceId:completed.workspaceId,actorId:completed.userId,action:'auth.sign_in',targetType:'session',targetId:null,requestOrigin:request.get('origin')||request.get('referer')||null,details:{mfaVerified:true}});
  recordAuditEvent({workspaceId:completed.workspaceId,actorId:completed.userId,action:'mfa.challenge_succeeded',targetType:'user',targetId:completed.userId,requestOrigin:request.get('origin')||request.get('referer')||null});
  if(request.body?.recoveryCode)recordAuditEvent({workspaceId:completed.workspaceId,actorId:completed.userId,action:'mfa.recovery_code_used',targetType:'user',targetId:completed.userId,requestOrigin:request.get('origin')||request.get('referer')||null});
  return response.json({ authenticated: true, user: sessionUser({ ...user, mfaVerified: true }) });
});
authRouter.post('/mfa/enroll/start', requireAuth, authRateLimit, (request, response) => {
  if (!request.user.emailVerified) return response.status(403).json({ error: 'Verify your email before setting up MFA.' });
  const current = getMfaUser(request.user.userId);
  if (current?.enabled) return response.status(409).json({ error: 'MFA is already enabled.' });
  const secret = generateTotpSecret();
  savePendingMfaSecret(request.user.userId, encryptTotpSecret(secret));
  recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'mfa.enrollment_started',targetType:'user',targetId:request.user.userId,requestOrigin:request.get('origin')||request.get('referer')||null});
  return response.json({ data: { secret, otpauthUrl: enrollmentUri(secret, request.user.email) } });
});
authRouter.post('/mfa/enroll/confirm', requireAuth, authRateLimit, (request, response) => {
  const current = getMfaUser(request.user.userId);
  if (!current?.pendingSecretEncrypted || current.enabled) return response.status(409).json({ error: 'Start MFA setup before confirming it.' });
  const secret = decryptTotpSecret(current.pendingSecretEncrypted);
  const step = matchingTotpStep(secret, request.body?.code, Date.now(), current.lastStep);
  const keys = authKeys(request, request.user.email).filter((key) => key.startsWith('pair:'));
  if (step === null) { recordAuthFailure(keys); return response.status(400).json({ error: 'Enter a current code from your authenticator app.' }); }
  const recoveryCodes = generateRecoveryCodes();
  const encrypted = current.pendingSecretEncrypted;
  const activated = activateMfa(request.user.userId, encrypted, step, recoveryCodes.map(hashRecoveryCode), rawCookie(request).split('.')[0]);
  if (!activated) return response.status(409).json({ error: 'MFA setup could not be completed. Start again.' });
  recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'mfa.enabled',targetType:'user',targetId:request.user.userId,requestOrigin:request.get('origin')||request.get('referer')||null});
  clearAuthFailures(keys);
  return response.json({ enabled: true, recoveryCodes, user: { ...sessionUser({ ...request.user, mfaEnabled: true, mfaVerified: true }), mfaSetupRequired: false } });
});
authRouter.post('/reauth', requireAuth, authRateLimit, async (request, response, next) => {
  try {
    if (request.body?.password) {
      const user = await authenticateUser(request.user.email, String(request.body.password));
      if (!user || user.id !== request.user.userId) return response.status(401).json({ error: 'The password is incorrect.' });
    } else if (request.body?.code) {
      const mfa = getMfaUser(request.user.userId);
      if (!mfa?.enabled) return response.status(400).json({ error: 'MFA is not enabled for this account.' });
      const step = matchingTotpStep(decryptTotpSecret(mfa.secretEncrypted), request.body.code, Date.now(), mfa.lastStep);
      if (step === null || !consumeTotpStep(request.user.userId, step)) return response.status(401).json({ error: 'The verification code is incorrect or was already used.' });
    } else return response.status(400).json({ error: 'Enter your password or an authenticator code.' });
    markSessionRecentlyAuthenticated(rawCookie(request).split('.')[0]);
    return response.json({ confirmed: true, expiresInSeconds: 600 });
  } catch (error) { return next(error); }
});
authRouter.get('/sessions', requireAuth, (request, response) => response.json({ data: listActiveSessions(request.user.userId) }));
authRouter.delete('/sessions/:sessionId', requireAuth, (request, response) => {
  const revoked = revokeListedSession(request.user.userId, request.params.sessionId);
  if(revoked)recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'auth.session_revoked',targetType:'session',targetId:request.params.sessionId,requestOrigin:request.get('origin')||request.get('referer')||null});
  return revoked ? response.json({ revoked: true }) : response.status(404).json({ error: 'Session not found.' });
});
authRouter.post('/logout', (request, response) => {
  const id = rawCookie(request).split('.')[0];
  const session=readSession(request);
  if (id) revokeSession(id);
  if(session)recordAuditEvent({workspaceId:session.workspaceId,actorId:session.userId,action:'auth.sign_out',targetType:'session',targetId:session.id,requestOrigin:request.get('origin')||request.get('referer')||null});
  response.setHeader('Set-Cookie', [`${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`, `${csrfCookieName}=; Path=/; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`]);
  return response.json({ authenticated: false });
});
authRouter.post('/logout-everywhere', requireAuth, (request, response) => {
  revokeUserSessions(request.user.userId);
  recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'auth.sign_out_everywhere',targetType:'account',targetId:request.user.userId,requestOrigin:request.get('origin')||request.get('referer')||null});
  response.setHeader('Set-Cookie', [`${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`, `${csrfCookieName}=; Path=/; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`]);
  return response.json({ authenticated: false, revoked: true });
});

export function requireAuth(request, response, next) {
  if (!ready()) return response.status(503).json({ error: 'Authentication service is not configured.' });
  const session = readSession(request);
  if (!session) return response.status(401).json({ error: 'Sign in to continue.' });
  request.user = session;
  return next();
}
export function requireWorkspaceAuth(request, response, next) {
  return requireAuth(request, response, (error) => {
    if (error) return next(error);
    if (!request.user.emailVerified) return response.status(403).json({ error: 'Verify your email before accessing workspace data.', code: 'email_verification_required' });
    if (requiresMfa(request.user.role) && !request.user.mfaEnabled) return response.status(403).json({ error: 'Set up multi-factor authentication to continue.', code: 'mfa_setup_required' });
    if (request.user.mfaEnabled && !request.user.mfaVerified) return response.status(403).json({ error: 'Complete multi-factor authentication to continue.', code: 'mfa_challenge_required' });
    return next();
  });
}
export function requireRecentAuth(request, response, next) {
  const threshold = Date.now() - 10 * 60 * 1000;
  const verifiedAt = Math.max(Date.parse(request.user.mfaVerifiedAt || '') || 0, Date.parse(request.user.recentAuthAt || '') || 0);
  if (verifiedAt >= threshold) return next();
  return response.status(428).json({ error: 'Confirm your password or MFA to continue.', code: 'recent_auth_required' });
}
export function requireRole(roles) { return (request, response, next) => roles.includes(request.user?.role) ? next() : response.status(403).json({ error: 'Your workspace role cannot perform this action.' }); }
export function csrfProtection(request, response, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.path !== '/auth/csrf') {
    const provided = request.get('x-csrf-token') || '';
    const stored = cookie(request, csrfCookieName);
    const [sessionId, sessionSignature] = rawCookie(request).split('.');
    const signedSession = sessionId && sessionSignature && equalText(sessionSignature, sign(sessionId));
    const sessionToken = signedSession ? `${sessionCsrfToken(sessionId)}.${csrfSignature(sessionCsrfToken(sessionId))}` : '';
    const [preAuthToken, preAuthSignature] = stored.split('.');
    const validPreAuth = preAuthToken && preAuthSignature && equalText(preAuthSignature, csrfSignature(preAuthToken));
    const valid = signedSession ? equalText(provided, sessionToken) && equalText(stored, sessionToken) : validPreAuth && equalText(provided, stored);
    if (!valid) return response.status(403).json({ error: 'Request verification failed. Refresh the page and try again.' });
  }
  next();
}
