import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

let directory, store, server, base, app, mfa, mailer;
let ownerA, ownerB, memberA, reviewA, sourceA, jarA, jarB, csrfA, csrfB;
let ownerC, workspaceC, ownerCCookie, ownerCCsrf, ownerCRecoveryCodes, ownerCTotpSecret;
const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const recoveryUsage = new Map();
let ownerBPassword = 'LongAndUniquePassword_B!2026';

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cleared-phase-1a-'));
  process.env.CLEARED_DB_PATH = path.join(directory, 'test.sqlite');
  process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
  process.env.MFA_ENCRYPTION_KEY = '11'.repeat(32);
  process.env.NODE_ENV = 'test';
  store = await import('../src/services/store.js');
  mfa = await import('../src/services/mfa.js');
  mailer = await import('../src/services/mailer.js');
  ({ createApp: app } = await import('../src/server.js'));
  ownerA = await store.createWorkspaceAccount({ workspaceName: 'Company A', email: 'owner-a@test.example', password: 'LongAndUniquePassword_A!2026' });
  ownerB = await store.createWorkspaceAccount({ workspaceName: 'Company B', email: 'owner-b@test.example', password: ownerBPassword });
  const invitation = store.createInvitation({ workspaceId: ownerA.workspace.id, email: 'member-a@test.example', role: 'creator', createdBy: ownerA.user.userId });
  memberA = (await store.acceptInvitation({ token: invitation.token, email: invitation.email, password: 'LongAndUniquePassword_M!2026' })).user;
  const seedDb = new DatabaseSync(process.env.CLEARED_DB_PATH);
  const encryptedTotp = mfa.encryptTotpSecret(TEST_TOTP_SECRET);
  for (const userId of [ownerA.user.userId, ownerB.user.userId, memberA.userId]) {
    seedDb.prepare('UPDATE users SET email_verified=1,mfa_enabled=1,mfa_secret_enc=?,mfa_last_step=-1 WHERE id=?').run(encryptedTotp, userId);
    for (let i = 0; i < 30; i++) seedDb.prepare('INSERT INTO mfa_recovery_codes(user_id,code_hash,created_at) VALUES(?,?,?)').run(userId, mfa.hashRecoveryCode(`TEST-${userId}-${i}`), new Date().toISOString());
  }
  seedDb.close();
  reviewA = { id: 'review-a', title: 'Private review A', content: 'private', status: 'In review', ownerId: ownerA.user.userId };
  sourceA = { id: 'source-a', name: 'Private source A', text: 'private source text' };
  store.saveReview(ownerA.workspace.id, reviewA);
  store.saveSource(ownerA.workspace.id, sourceA);
  const testApp = app(); testApp.set('trust proxy', 'loopback');
  server = testApp.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  jarA = await login('owner-a@test.example', 'LongAndUniquePassword_A!2026', ownerA.workspace.id);
  jarB = await login('owner-b@test.example', ownerBPassword, ownerB.workspace.id);
  csrfA = (await get('/api/auth/csrf', jarA)).data.token;
  csrfB = (await get('/api/auth/csrf', jarB)).data.token;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  store?.closeStore();
  await rm(directory, { recursive: true, force: true });
});

async function request(route, { method = 'GET', jar = '', token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, { method, headers: { ...(jar ? { Cookie: jar } : {}), ...(token ? { 'X-CSRF-Token': token } : {}), ...headers }, body, signal: AbortSignal.timeout(10000) });
  const cookies = response.headers.getSetCookie?.() || [];
  const updates = cookies.map((item) => item.split(';')[0]);
  const merged = new Map((jar ? jar.split('; ') : []).map((part) => part.split('=')));
  for (const part of updates) { const [name, ...value] = part.split('='); if (!value.join('=')) merged.delete(name); else merged.set(name, value.join('=')); }
  let data = {};
  try { data = await response.json(); } catch { /* response has no JSON body */ }
  return { status: response.status, data, jar: [...merged].map(([k,v]) => `${k}=${v}`).join('; '), headers: response.headers };
}
async function get(route, jar = '') { return request(route, { jar }); }
async function write(route, jar, token, method, body, headers = {}) { return request(route, { method, jar, token, body, headers }); }
async function login(email, password, workspaceId) {
  let result = await get('/api/auth/csrf');
  const token = result.data.token;
  result = await write('/api/auth/login', result.jar, token, 'POST', JSON.stringify({ email, password, workspaceId }), { 'Content-Type': 'application/json' });
  if (result.data.mfaRequired) {
    const userId = store.getUserByEmail(email)?.id;
    const index = recoveryUsage.get(userId) || 0; recoveryUsage.set(userId, index + 1);
    result = await write('/api/auth/mfa/challenge', result.jar, token, 'POST', JSON.stringify({ challengeToken: result.data.challengeToken, email, recoveryCode: `TEST-${userId}-${index}` }), { 'Content-Type': 'application/json' });
  }
  assert.equal(result.status, 200);
  return result.jar;
}

test('database sessions persist, record activity, can be listed and revoked', async () => {
  const rawId = jarA.match(/(?:__Host-)?cleared_session=([^.;]+)/)?.[1];
  assert.ok(rawId);
  assert.equal(store.hashSessionId(rawId).includes(rawId), false);
  const before = store.listActiveSessions(ownerA.user.userId);
  assert.ok(before.length >= 1);
  const previousLastUsed = before[0].lastUsedAt;
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.equal((await get('/api/workspace', jarA)).status, 200);
  const afterRead = store.listActiveSessions(ownerA.user.userId);
  assert.equal(afterRead[0].lastUsedAt, previousLastUsed);
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.equal((await write('/api/workspace/members/missing-id', jarA, csrfA, 'PATCH', JSON.stringify({ role: 'reviewer' }), { 'Content-Type': 'application/json' })).status, 404);
  assert.ok(store.listActiveSessions(ownerA.user.userId)[0].lastUsedAt >= previousLastUsed);
  const sessions = await get('/api/auth/sessions', jarA);
  assert.equal(sessions.status, 200);
  assert.ok(sessions.data.data.length >= 1);
  assert.ok('userAgent' in sessions.data.data[0]);
  const revoke = await write(`/api/auth/sessions/${sessions.data.data[0].id}`, jarA, csrfA, 'DELETE');
  assert.equal(revoke.status, 200);
  assert.equal((await get('/api/workspace', jarA)).status, 401);
  const previousSessionCookie = rawId;
  jarA = await login('owner-a@test.example', 'LongAndUniquePassword_A!2026', ownerA.workspace.id);
  assert.notEqual(jarA.match(/(?:__Host-)?cleared_session=([^.;]+)/)?.[1], previousSessionCookie);
  const csrfAfterLogin = await get('/api/auth/csrf', jarA); csrfA = csrfAfterLogin.data.token; jarA = csrfAfterLogin.jar;
  assert.equal((await write('/api/auth/logout', jarA, csrfA, 'POST')).status, 200);
  assert.equal((await get('/api/workspace', jarA)).status, 401);
  jarA = await login('owner-a@test.example', 'LongAndUniquePassword_A!2026', ownerA.workspace.id);
  const csrf = await get('/api/auth/csrf', jarA); csrfA = csrf.data.token; jarA = csrf.jar;
});

test('cookie writes require CSRF and responses include security headers', async () => {
  assert.equal((await request('/api/workspace/invitations', { method: 'POST', jar: jarA, body: '{}' })).status, 403);
  const response = await get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.doesNotMatch(response.headers.get('content-security-policy') || '', /script-src[^;]*unsafe-inline/);
  const previousMode = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const productionHeaders = await get('/api/health');
  process.env.NODE_ENV = previousMode;
  assert.match(productionHeaders.headers.get('strict-transport-security') || '', /max-age=31536000/);
});

test('CORS accepts configured development origin and rejects other origins', async () => {
  const allowed = await request('/api/health', { headers: { Origin: 'http://localhost:5173' } });
  const denied = await request('/api/health', { headers: { Origin: 'https://attacker.example' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('production startup rejects weak secrets and non-HTTPS wildcard origins', async () => {
  const { validateEnvironment } = await import('../src/server.js');
  const valid = { NODE_ENV: 'production', SESSION_SECRET: 'strong-random-secret-that-is-over-thirty-two-characters', CORS_ORIGINS: 'https://app.example', APP_BASE_URL: 'https://app.example', SMTP_HOST: 'smtp.example', SMTP_PORT: '587', SMTP_USER: 'sender', SMTP_PASS: 'mail-secret', MAIL_FROM: 'noreply@example.com', MFA_ENCRYPTION_KEY: '22'.repeat(32) };
  assert.throws(() => validateEnvironment({ ...valid, SESSION_SECRET: 'weak' }), /strong SESSION_SECRET/);
  assert.throws(() => validateEnvironment({ ...valid, CORS_ORIGINS: '*' }), /exact origin/);
  assert.throws(() => validateEnvironment({ ...valid, CORS_ORIGINS: 'http://app.example' }), /HTTPS/);
  assert.equal(validateEnvironment(valid), true);
});

test('password checks reject common password patterns and persist OWASP scrypt parameters', async () => {
  assert.equal(store.isCommonPassword('Password123456!'), true);
  assert.equal(store.isCommonPassword('DifferentWords!Together2026'), false);
  const user = store.getUserByEmail('owner-a@test.example');
  assert.deepEqual(JSON.parse(user.password_params), { N: 131072, r: 8, p: 1, keyLength: 64 });
  const legacySalt = 'legacy-test-salt';
  const legacyHash = scryptSync('LongAndUniquePassword_A!2026', legacySalt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  const migrationDb = new DatabaseSync(process.env.CLEARED_DB_PATH);
  migrationDb.prepare('UPDATE users SET password_salt=?,password_hash=?,password_params=? WHERE id=?').run(legacySalt, legacyHash, JSON.stringify({ N: 16384, r: 8, p: 1, keyLength: 64 }), ownerA.user.userId);
  migrationDb.close();
  assert.equal((await store.authenticateUser('owner-a@test.example', 'LongAndUniquePassword_A!2026')).id, ownerA.user.userId);
  assert.deepEqual(JSON.parse(store.getUserByEmail('owner-a@test.example').password_params), { N: 131072, r: 8, p: 1, keyLength: 64 });
});

test('concurrent password hashing stays within the memory bound', async (t) => {
  const baseline = process.memoryUsage().rss;
  let peakRss = baseline;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 5);
  try {
    await Promise.all(Array.from({ length: 6 }, (_, index) => store.createWorkspaceAccount({ workspaceName: `Load ${index}`, email: `load-${index}@test.example`, password: `ConcurrentHashingPassword_${index}!2026` })));
  } finally { clearInterval(sampler); }
  const stats = store.passwordHashingStats();
  assert.equal(stats.maxmemBytes, 160 * 1024 * 1024);
  assert.equal(stats.concurrencyLimit, 2);
  assert.ok(stats.peak <= 2);
  assert.ok(peakRss <= 512 * 1024 * 1024, `peak RSS was ${Math.round(peakRss / 1024 / 1024)} MiB`);
  t.diagnostic(`six concurrent hash requests; max concurrent scrypt=${stats.peak}/${stats.concurrencyLimit}; RSS=${Math.round(baseline / 1024 / 1024)} MiB baseline, ${Math.round(peakRss / 1024 / 1024)} MiB peak`);
});

test('workspace bootstrap issues its own authenticated session', async () => {
  const csrf = await get('/api/auth/csrf');
  const outboxStart=mailer.developmentOutbox.length;
  const response=await write('/api/auth/workspaces', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ workspaceName: 'Company C', email: 'owner-c@test.example', password: 'LongAndUniquePassword_C!2026' }), { 'Content-Type': 'application/json' });
  assert.equal(response.status, 201);
  assert.equal(response.data.user.email, 'owner-c@test.example');
  assert.equal(response.data.user.emailVerified, false);
  assert.equal((await get('/api/workspace', response.jar)).data.code, 'email_verification_required');
  ownerCCookie = response.jar;
  const firstToken = mailer.developmentOutbox.slice(outboxStart).at(-1)?.text.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(firstToken);
  const sessionCsrf = await get('/api/auth/csrf', ownerCCookie); ownerCCookie = sessionCsrf.jar; ownerCCsrf = sessionCsrf.data.token;
  assert.equal((await write('/api/auth/email/verify', ownerCCookie, ownerCCsrf, 'POST', JSON.stringify({ token: `${firstToken}tampered` }), { 'Content-Type': 'application/json' })).status, 400);
  const tokenHash = createHash('sha256').update(firstToken).digest('hex');
  const expireDb = new DatabaseSync(process.env.CLEARED_DB_PATH);
  expireDb.prepare('UPDATE account_action_tokens SET expires_at=? WHERE token_hash=?').run(new Date(0).toISOString(), tokenHash);
  expireDb.close();
  assert.equal((await write('/api/auth/email/verify', ownerCCookie, ownerCCsrf, 'POST', JSON.stringify({ token: firstToken }), { 'Content-Type': 'application/json' })).status, 400);
  const resendStart=mailer.developmentOutbox.length;
  assert.equal((await write('/api/auth/email/resend', ownerCCookie, ownerCCsrf, 'POST', JSON.stringify({ email: 'owner-c@test.example' }), { 'Content-Type': 'application/json' })).status, 202);
  const token = mailer.developmentOutbox.slice(resendStart).at(-1)?.text.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token);
  assert.deepEqual(store.getActionToken(token, 'email_verify')?.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal((await write('/api/auth/email/verify', ownerCCookie, ownerCCsrf, 'POST', JSON.stringify({ token }), { 'Content-Type': 'application/json' })).status, 200);
  assert.equal((await write('/api/auth/email/verify', ownerCCookie, ownerCCsrf, 'POST', JSON.stringify({ token }), { 'Content-Type': 'application/json' })).status, 400);
  const current = await get('/api/auth/session', ownerCCookie);
  ownerC = current.data.user;
  workspaceC = current.data.user.workspace.id;
  assert.equal(current.data.user.emailVerified, true);
  assert.equal(current.data.user.mfaSetupRequired, true);
  assert.equal((await get('/api/workspace', ownerCCookie)).data.code, 'mfa_setup_required');
  const mfaCsrf = await get('/api/auth/csrf', ownerCCookie); ownerCCookie = mfaCsrf.jar; ownerCCsrf = mfaCsrf.data.token;
  const started = await write('/api/auth/mfa/enroll/start', ownerCCookie, mfaCsrf.data.token, 'POST');
  assert.equal(started.status, 200);
  assert.match(started.data.data.otpauthUrl, /^otpauth:\/\/totp\//);
  ownerCTotpSecret = started.data.data.secret;
  const code = mfa.totpAt(started.data.data.secret);
  const enrolled = await write('/api/auth/mfa/enroll/confirm', ownerCCookie, mfaCsrf.data.token, 'POST', JSON.stringify({ code }), { 'Content-Type': 'application/json' });
  assert.equal(enrolled.status, 200);
  ownerCRecoveryCodes = enrolled.data.recoveryCodes;
  assert.equal(enrolled.data.recoveryCodes.length, 10);
  assert.equal(enrolled.data.user.mfaEnabled, true);
  assert.equal((await get('/api/workspace', ownerCCookie)).status, 200);
  const verifyDb = new DatabaseSync(process.env.CLEARED_DB_PATH);
  assert.equal(verifyDb.prepare('SELECT COUNT(*) AS count FROM mfa_recovery_codes WHERE user_id=? AND code_hash=?').get(enrolled.data.user.id, mfa.hashRecoveryCode(enrolled.data.recoveryCodes[0])).count, 1);
  verifyDb.close();
});

test('MFA rejects replay of an accepted TOTP step', async () => {
  let csrf = await get('/api/auth/csrf', ownerCCookie); ownerCCookie = csrf.jar;
  const login = await write('/api/auth/login', ownerCCookie, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, password: 'LongAndUniquePassword_C!2026', workspaceId: workspaceC }), { 'Content-Type': 'application/json' });
  assert.equal(login.data.mfaRequired, true);
  const step = Math.max(Math.floor(Date.now() / 30000), store.getMfaUser(ownerC.id).lastStep + 1);
  const code = mfa.totpAt(ownerCTotpSecret, step);
  const accepted = await write('/api/auth/mfa/challenge', login.jar, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, challengeToken: login.data.challengeToken, code }), { 'Content-Type': 'application/json' });
  assert.equal(accepted.status, 200); ownerCCookie = accepted.jar;
  csrf = await get('/api/auth/csrf', ownerCCookie); ownerCCookie = csrf.jar;
  const replay = await write('/api/auth/mfa/challenge', ownerCCookie, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, challengeToken: login.data.challengeToken, code }), { 'Content-Type': 'application/json' });
  assert.equal(replay.status, 401);
});

test('MFA recovery codes are one-time', async () => {
  let csrf = await get('/api/auth/csrf', ownerCCookie); ownerCCookie = csrf.jar;
  let login = await write('/api/auth/login', ownerCCookie, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, password: 'LongAndUniquePassword_C!2026', workspaceId: workspaceC }), { 'Content-Type': 'application/json' });
  const accepted = await write('/api/auth/mfa/challenge', login.jar, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, challengeToken: login.data.challengeToken, recoveryCode: ownerCRecoveryCodes[0] }), { 'Content-Type': 'application/json' });
  assert.equal(accepted.status, 200); ownerCCookie = accepted.jar;
  csrf = await get('/api/auth/csrf', ownerCCookie);
  const logout = await write('/api/auth/logout', ownerCCookie, csrf.data.token, 'POST'); ownerCCookie = logout.jar;
  csrf = await get('/api/auth/csrf', ownerCCookie); ownerCCookie = csrf.jar;
  login = await write('/api/auth/login', ownerCCookie, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, password: 'LongAndUniquePassword_C!2026', workspaceId: workspaceC }), { 'Content-Type': 'application/json' });
  const reused = await write('/api/auth/mfa/challenge', login.jar, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, challengeToken: login.data.challengeToken, recoveryCode: ownerCRecoveryCodes[0] }), { 'Content-Type': 'application/json' });
  assert.equal(reused.status, 401);
  const unused = await write('/api/auth/mfa/challenge', login.jar, csrf.data.token, 'POST', JSON.stringify({ email: ownerC.email, challengeToken: login.data.challengeToken, recoveryCode: ownerCRecoveryCodes[1] }), { 'Content-Type': 'application/json' });
  assert.equal(unused.status, 200);
});

test('every workspace API family keeps cross-workspace identifiers isolated', async () => {
  assert.notEqual((await get('/api/workspace', jarB)).data.data.id, ownerA.workspace.id);
  const membersB = await get('/api/workspace/members', jarB);
  assert.equal(membersB.status, 200);
  assert.equal(membersB.data.data.some((member) => member.userId === memberA.userId), false);
  const duplicateInvite = await write('/api/workspace/invitations', jarB, csrfB, 'POST', JSON.stringify({ email: ownerB.user.email, role: 'creator' }), { 'Content-Type': 'application/json' });
  assert.equal(duplicateInvite.status, 409);
  assert.equal(duplicateInvite.data.error, 'Could not create this invitation.');
  const inviteOutboxStart=mailer.developmentOutbox.length;
  const sentInvite=await write('/api/workspace/invitations', jarB, csrfB, 'POST', JSON.stringify({ email: 'x@test.example', role: 'creator' }), { 'Content-Type': 'application/json' });
  assert.equal(sentInvite.status, 201);
  assert.equal(sentInvite.data.data.inviteUrl, undefined);
  const inviteMessage=mailer.developmentOutbox.slice(inviteOutboxStart).at(-1);
  assert.match(inviteMessage.text, /You have been invited to join Company B/);
  const inviteToken = inviteMessage.text.match(/join\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(inviteToken);
  const inviteCsrf = await get('/api/auth/csrf');
  const accepted = await write('/api/auth/invitations/accept', inviteCsrf.jar, inviteCsrf.data.token, 'POST', JSON.stringify({ token: inviteToken, email: 'x@test.example', password: 'InviteeUniquePassword_X!2026' }), { 'Content-Type': 'application/json' });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.data.user.emailVerified, true);
  assert.equal((await get('/api/auth/session', accepted.jar)).data.user.emailVerified, true);
  assert.equal((await write(`/api/workspace/members/${memberA.userId}`, jarB, csrfB, 'PATCH', JSON.stringify({ role: 'reviewer' }), { 'Content-Type': 'application/json' })).status, 404);
  assert.equal((await write(`/api/workspace/members/${memberA.userId}`, jarB, csrfB, 'DELETE')).status, 404);
  assert.deepEqual((await get('/api/reviews', jarB)).data.data, []);
  assert.equal((await write('/api/reviews', jarB, csrfB, 'POST', JSON.stringify({ title: 'Cross tenant', content: 'x' }), { 'Content-Type': 'application/json' })).status, 201);
  assert.equal((await write('/api/reviews/review-a', jarB, csrfB, 'PATCH', JSON.stringify({ status: 'Approved' }), { 'Content-Type': 'application/json' })).status, 404);
  assert.deepEqual((await get('/api/sources', jarB)).data.data, []);
  const form = new FormData(); form.set('name', 'B source'); form.set('category', 'Policies'); form.set('file', new Blob(['private B content'], { type: 'text/plain' }), 'b.txt');
  assert.equal((await write('/api/sources', jarB, csrfB, 'POST', form)).status, 201);
  assert.equal((await write('/api/verification/check/review-a', jarB, csrfB, 'POST')).status, 404);
  assert.equal((await write('/api/sources/source-a', jarB, csrfB, 'DELETE')).status, 404);
  assert.equal((await get('/api/auth/sessions', jarB)).status, 200);
  assert.equal((await get('/api/auth/sessions', jarB)).data.data.some((item) => item.userAgent === 'node' && item.workspaceId === ownerA.workspace.id), false);
  const aSessionId = (await get('/api/auth/sessions', jarA)).data.data[0].id;
  assert.equal((await write(`/api/auth/sessions/${aSessionId}`, jarB, csrfB, 'DELETE')).status, 404);
  assert.notEqual((await get('/api/auth/session', jarA)).data.user.id, ownerB.user.userId);
  const wrongWorkspace = await write('/api/auth/login', jarB, csrfB, 'POST', JSON.stringify({ email: 'owner-b@test.example', password: ownerBPassword, workspaceId: ownerA.workspace.id }), { 'Content-Type': 'application/json' });
  assert.equal(wrongWorkspace.status, 401);
  const foreignInvite = store.createInvitation({ workspaceId: ownerA.workspace.id, email: 'invite-target@test.example', role: 'creator', createdBy: ownerA.user.userId });
  const noTokenAccept = await write('/api/auth/invitations/accept', jarB, csrfB, 'POST', JSON.stringify({ token: 'not-a-real-token', email: foreignInvite.email, password: 'LongAndUniquePassword_X!2026' }), { 'Content-Type': 'application/json' });
  assert.equal(noTokenAccept.status, 400);
});

test('password reset is generic, hashed, expiring, single-use, revokes sessions, and clears lockout', async () => {
  const resetStateDb=new DatabaseSync(process.env.CLEARED_DB_PATH); const resetAccountHash=createHash('sha256').update('owner-b@test.example').digest('hex'); const resetIpHash=createHash('sha256').update('127.0.0.1').digest('hex'); resetStateDb.prepare('DELETE FROM auth_attempts WHERE bucket=?').run(`pair:${resetAccountHash}:${resetIpHash}`); resetStateDb.prepare('DELETE FROM request_limits').run(); resetStateDb.close();
  async function requestReset(email) {
    const start=mailer.developmentOutbox.length;
    const csrf = await get('/api/auth/csrf');
    const result=await write('/api/auth/password/forgot', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ email }), { 'Content-Type': 'application/json' });
    return { result, output:mailer.developmentOutbox.slice(start).map((item)=>item.text).join('\n') };
  }
  const real = await requestReset('owner-b@test.example');
  const unknown = await requestReset('nobody@test.example');
  assert.equal(real.result.status, 202);
  assert.deepEqual(real.result.data, unknown.result.data);
  const firstToken = real.output.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(firstToken);
  assert.equal(store.getActionToken(firstToken, 'password_reset')?.token_hash, createHash('sha256').update(firstToken).digest('hex'));
  let csrf = await get('/api/auth/csrf');
  assert.equal((await write('/api/auth/password/reset', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ token: `${firstToken}tampered`, email: 'owner-b@test.example', password: 'ReplacementPassword_B!2026' }), { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await write('/api/auth/password/reset', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ token: firstToken, email: 'wrong@test.example', password: 'ReplacementPassword_B!2026' }), { 'Content-Type': 'application/json' })).status, 400);
  const firstHash = createHash('sha256').update(firstToken).digest('hex');
  const expiryDb = new DatabaseSync(process.env.CLEARED_DB_PATH);
  expiryDb.prepare('UPDATE account_action_tokens SET expires_at=? WHERE token_hash=?').run(new Date(0).toISOString(), firstHash);
  expiryDb.close();
  assert.equal((await write('/api/auth/password/reset', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ token: firstToken, email: 'owner-b@test.example', password: 'ReplacementPassword_B!2026' }), { 'Content-Type': 'application/json' })).status, 400);
  const localIpHash=createHash('sha256').update('127.0.0.1').digest('hex'); const resetPair=`pair:${createHash('sha256').update('owner-b@test.example').digest('hex')}:${localIpHash}`;
  for(let i=0;i<3;i++)assert.equal((await write('/api/auth/password/reset',csrf.jar,csrf.data.token,'POST',JSON.stringify({token:firstToken,email:'owner-b@test.example',password:'ReplacementPassword_B!2026'}),{'Content-Type':'application/json'})).status,400);
  assert.equal((await write('/api/auth/password/reset',csrf.jar,csrf.data.token,'POST',JSON.stringify({token:firstToken,email:'owner-b@test.example',password:'ReplacementPassword_B!2026'}),{'Content-Type':'application/json'})).status,429);
  store.clearAuthFailures([resetPair]);

  const accountHash = createHash('sha256').update('owner-b@test.example').digest('hex');
  const attackerIp = createHash('sha256').update('203.0.113.55').digest('hex');
  for (let i = 0; i < 5; i++) store.recordAuthFailure([`pair:${accountHash}:${attackerIp}`]);
  assert.ok(store.checkAuthLimit([`pair:${accountHash}:${attackerIp}`]) > 0);
  const second = await requestReset('owner-b@test.example');
  const resetToken = second.output.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(resetToken);
  csrf = await get('/api/auth/csrf');
  ownerBPassword = 'ReplacementPassword_B!2026';
  const reset = await write('/api/auth/password/reset', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ token: resetToken, email: 'owner-b@test.example', password: ownerBPassword }), { 'Content-Type': 'application/json' });
  assert.equal(reset.status, 200);
  assert.equal(store.checkAuthLimit([`pair:${accountHash}:${attackerIp}`]), 0);
  assert.equal((await get('/api/workspace', jarB)).status, 401);
  assert.equal((await write('/api/auth/password/reset', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ token: resetToken, email: 'owner-b@test.example', password: 'AnotherReplacementPassword_B!2026' }), { 'Content-Type': 'application/json' })).status, 400);
  jarB = await login('owner-b@test.example', ownerBPassword, ownerB.workspace.id);
  const nextCsrf = await get('/api/auth/csrf', jarB); jarB = nextCsrf.jar; csrfB = nextCsrf.data.token;
  async function requestUnlock(email) { const start=mailer.developmentOutbox.length; const tokenPage=await get('/api/auth/csrf'); const result=await write('/api/auth/account/unlock',tokenPage.jar,tokenPage.data.token,'POST',JSON.stringify({email}),{'Content-Type':'application/json'}); return {result,output:mailer.developmentOutbox.slice(start).map((item)=>item.text).join('\n')}; }
  const unlock=await requestUnlock('owner-b@test.example'); const unknownUnlock=await requestUnlock('not-here@test.example');
  assert.equal(unlock.result.status,202); assert.deepEqual(unlock.result.data,unknownUnlock.result.data);
  const unlockToken=unlock.output.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1]; assert.ok(unlockToken);
  const unlockCsrf=await get('/api/auth/csrf');
  for(let i=0;i<5;i++)store.recordAuthFailure([`pair:${accountHash}:${attackerIp}`]);
  assert.ok(store.checkAuthLimit([`pair:${accountHash}:${attackerIp}`])>0);
  assert.equal((await write('/api/auth/email/verify',unlockCsrf.jar,unlockCsrf.data.token,'POST',JSON.stringify({token:unlockToken}),{'Content-Type':'application/json'})).status,200);
  assert.equal(store.checkAuthLimit([`pair:${accountHash}:${attackerIp}`]),0);
  assert.equal((await write('/api/auth/email/verify',unlockCsrf.jar,unlockCsrf.data.token,'POST',JSON.stringify({token:unlockToken}),{'Content-Type':'application/json'})).status,400);
});

test('email change requires the current password, verifies the new address, and notifies the old address', async () => {
  const newEmail = 'owner-b-new@test.example';
  let csrf = await get('/api/auth/csrf', jarB); jarB = csrf.jar; csrfB = csrf.data.token;
  const wrong = await write('/api/auth/email/change', jarB, csrfB, 'POST', JSON.stringify({ currentPassword: 'wrong-password-123', newEmail }), { 'Content-Type': 'application/json' });
  assert.equal(wrong.status, 400);
  const outputStart=mailer.developmentOutbox.length;
  const changed=await write('/api/auth/email/change', jarB, csrfB, 'POST', JSON.stringify({ currentPassword: ownerBPassword, newEmail }), { 'Content-Type': 'application/json' });
  const output=mailer.developmentOutbox.slice(outputStart).map((item)=>`To: ${item.to}\nSubject: ${item.subject}\n${item.text}`).join('\n');
  assert.equal(changed.status, 202);
  assert.match(output, /To: owner-b-new@test\.example/);
  assert.match(output, /To: owner-b@test\.example/);
  assert.match(output, /Cleared email change requested/);
  const token = output.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token);
  const stored = store.getActionToken(token, 'email_change');
  assert.equal(stored.target_email, newEmail);
  assert.equal((await write('/api/auth/email/verify', jarB, csrfB, 'POST', JSON.stringify({ token }), { 'Content-Type': 'application/json' })).status, 200);
  assert.equal(store.getUserByEmail(newEmail).id, ownerB.user.userId);
  assert.equal(Boolean(store.getUserByEmail('owner-b@test.example')), false);
  assert.equal((await get('/api/workspace', jarB)).status, 401);
  const preauth = await get('/api/auth/csrf');
  assert.equal((await write('/api/auth/login', preauth.jar, preauth.data.token, 'POST', JSON.stringify({ email: 'owner-b@test.example', password: ownerBPassword, workspaceId: ownerB.workspace.id }), { 'Content-Type': 'application/json' })).status, 401);
  jarB = await login(newEmail, ownerBPassword, ownerB.workspace.id);
  csrf = await get('/api/auth/csrf', jarB); jarB = csrf.jar; csrfB = csrf.data.token;
});

test('CSRF tokens are session-bound and cannot be reused across user sessions', async () => {
  const mismatched = await write('/api/workspace/invitations', jarB, csrfA, 'POST', JSON.stringify({ email: 'csrf@test.example', role: 'creator' }), { 'Content-Type': 'application/json' });
  assert.equal(mismatched.status, 403);
  const matching = await write('/api/workspace/invitations', jarB, csrfB, 'POST', JSON.stringify({ email: 'csrf@test.example', role: 'creator' }), { 'Content-Type': 'application/json' });
  assert.equal(matching.status, 201);
});

test('membership role changes and removals revoke that workspace session immediately', async () => {
  let memberCookie = await login(memberA.email, 'LongAndUniquePassword_M!2026', ownerA.workspace.id);
  const roleChange = await write(`/api/workspace/members/${memberA.userId}`, jarA, csrfA, 'PATCH', JSON.stringify({ role: 'reviewer' }), { 'Content-Type': 'application/json' });
  assert.equal(roleChange.status, 200);
  assert.equal((await get('/api/workspace', memberCookie)).status, 401);
  memberCookie = await login(memberA.email, 'LongAndUniquePassword_M!2026', ownerA.workspace.id);
  const removal = await write(`/api/workspace/members/${memberA.userId}`, jarA, csrfA, 'DELETE');
  assert.equal(removal.status, 200);
  assert.equal((await get('/api/workspace', memberCookie)).status, 401);
});

test('expired and revoked session rows are removed by the periodic purge operation', () => {
  store.createSession({ id: 'purge-expired-test-session', userId: ownerA.user.userId, workspaceId: ownerA.workspace.id, expiresAt: new Date(0).toISOString() });
  store.createSession({ id: 'purge-revoked-test-session', userId: ownerA.user.userId, workspaceId: ownerA.workspace.id });
  store.revokeSession('purge-revoked-test-session');
  const result = store.purgeSessions();
  assert.ok(result.sessions >= 2);
});

test('sign out everywhere revokes every session for the account', async () => {
  jarA = await login('owner-a@test.example', 'LongAndUniquePassword_A!2026', ownerA.workspace.id);
  const csrf = await get('/api/auth/csrf', jarA); jarA = csrf.jar;
  const secondSession = await login('owner-a@test.example', 'LongAndUniquePassword_A!2026', ownerA.workspace.id);
  assert.equal((await get('/api/auth/sessions', secondSession)).data.data.length >= 2, true);
  const ended = await write('/api/auth/logout-everywhere', jarA, csrf.data.token, 'POST');
  assert.equal(ended.status, 200);
  assert.equal((await get('/api/workspace', jarA)).status, 401);
  assert.equal((await get('/api/workspace', secondSession)).status, 401);
  assert.equal((await get('/api/workspace', jarB)).status, 200);
});

test('production session cookies use the __Host- prefix with Secure and Path=/', async () => {
  const previousMode = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    const csrf = await get('/api/auth/csrf');
    const response = await write('/api/auth/login', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ email: 'owner-a@test.example', password: 'LongAndUniquePassword_A!2026', workspaceId: ownerA.workspace.id }), { 'Content-Type': 'application/json' });
    assert.equal(response.status, 200);
    const setCookies = response.headers.getSetCookie();
    const sessionCookie = setCookies.find((item) => item.startsWith('__Host-cleared_session='));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /; Secure/);
    assert.match(sessionCookie, /Path=\//);
    assert.doesNotMatch(sessionCookie, /Domain=/i);
  } finally { process.env.NODE_ENV = previousMode; }
});

test('invitation acceptance failures are generic and progressively locked', async () => {
  const limitsDb = new DatabaseSync(process.env.CLEARED_DB_PATH); limitsDb.prepare('DELETE FROM request_limits').run(); limitsDb.close();
  const csrf = await get('/api/auth/csrf');
  let response;
  for (let i = 0; i < 5; i++) {
    response = await write('/api/auth/invitations/accept', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ token: `invalid-${i}`, email: 'guessing@test.example', password: 'LongAndUniquePassword_X!2026' }), { 'Content-Type': 'application/json' });
    assert.equal(response.status, 400);
    assert.equal(response.data.error, 'The invitation details are invalid or expired.');
  }
  response = await write('/api/auth/invitations/accept', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ token: 'invalid-final', email: 'guessing@test.example', password: 'LongAndUniquePassword_X!2026' }), { 'Content-Type': 'application/json' });
  assert.equal(response.status, 429);
});

test('login failures use generic errors and progressive lockout', async () => {
  const limitsDb = new DatabaseSync(process.env.CLEARED_DB_PATH); limitsDb.prepare('DELETE FROM request_limits').run(); limitsDb.close();
  const csrf = await get('/api/auth/csrf');
  let response;
  const forwarded = { 'X-Forwarded-For': '198.51.100.77' };
  for (let i = 0; i < 5; i++) {
    response = await write('/api/auth/login', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ email: 'missing-user@test.example', password: 'WrongPassword_2026!!', workspaceId: ownerA.workspace.id }), { 'Content-Type': 'application/json', ...forwarded });
    assert.equal(response.status, 401);
    assert.equal(response.data.error, 'The email, password, or workspace is incorrect.');
  }
  response = await write('/api/auth/login', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ email: 'missing-user@test.example', password: 'WrongPassword_2026!!', workspaceId: ownerA.workspace.id }), { 'Content-Type': 'application/json', ...forwarded });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});
