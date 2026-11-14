import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

let directory, store, server, base, app;
let ownerA, ownerB, memberA, reviewA, sourceA, jarA, jarB, csrfA, csrfB;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cleared-phase-1a-'));
  process.env.CLEARED_DB_PATH = path.join(directory, 'test.sqlite');
  process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  store = await import('../src/services/store.js');
  ({ createApp: app } = await import('../src/server.js'));
  ownerA = await store.createWorkspaceAccount({ workspaceName: 'Company A', email: 'owner-a@test.example', password: 'LongAndUniquePassword_A!2026' });
  ownerB = await store.createWorkspaceAccount({ workspaceName: 'Company B', email: 'owner-b@test.example', password: 'LongAndUniquePassword_B!2026' });
  const invitation = store.createInvitation({ workspaceId: ownerA.workspace.id, email: 'member-a@test.example', role: 'creator', createdBy: ownerA.user.userId });
  memberA = (await store.acceptInvitation({ token: invitation.token, email: invitation.email, password: 'LongAndUniquePassword_M!2026' })).user;
  reviewA = { id: 'review-a', title: 'Private review A', content: 'private', status: 'In review', ownerId: ownerA.user.userId };
  sourceA = { id: 'source-a', name: 'Private source A', text: 'private source text' };
  store.saveReview(ownerA.workspace.id, reviewA);
  store.saveSource(ownerA.workspace.id, sourceA);
  server = app().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  jarA = await login('owner-a@test.example', 'LongAndUniquePassword_A!2026', ownerA.workspace.id);
  jarB = await login('owner-b@test.example', 'LongAndUniquePassword_B!2026', ownerB.workspace.id);
  csrfA = (await get('/api/auth/csrf', jarA)).data.token;
  csrfB = (await get('/api/auth/csrf', jarB)).data.token;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  store?.closeStore();
  await rm(directory, { recursive: true, force: true });
});

async function request(route, { method = 'GET', jar = '', token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, { method, headers: { ...(jar ? { Cookie: jar } : {}), ...(token ? { 'X-CSRF-Token': token } : {}), ...headers }, body });
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
  assert.equal(result.status, 200);
  return result.jar;
}

test('database sessions persist, record activity, can be listed and revoked', async () => {
  const rawId = jarA.match(/cleared_session=([^.;]+)/)?.[1];
  assert.ok(rawId);
  assert.equal(store.hashSessionId(rawId).includes(rawId), false);
  const before = store.listActiveSessions(ownerA.user.userId);
  assert.ok(before.length >= 1);
  const previousLastUsed = before[0].lastUsedAt;
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.equal((await get('/api/workspace', jarA)).status, 200);
  const afterRead = store.listActiveSessions(ownerA.user.userId);
  assert.ok(afterRead[0].lastUsedAt >= previousLastUsed);
  const sessions = await get('/api/auth/sessions', jarA);
  assert.equal(sessions.status, 200);
  assert.ok(sessions.data.data.length >= 1);
  assert.ok('userAgent' in sessions.data.data[0]);
  const revoke = await write(`/api/auth/sessions/${sessions.data.data[0].id}`, jarA, csrfA, 'DELETE');
  assert.equal(revoke.status, 200);
  assert.equal((await get('/api/workspace', jarA)).status, 401);
  jarA = await login('owner-a@test.example', 'LongAndUniquePassword_A!2026', ownerA.workspace.id);
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
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production', SESSION_SECRET: 'weak', CORS_ORIGINS: 'https://app.example' }), /strong SESSION_SECRET/);
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production', SESSION_SECRET: 'strong-random-secret-that-is-over-thirty-two-characters', CORS_ORIGINS: '*' }), /exact origin/);
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production', SESSION_SECRET: 'strong-random-secret-that-is-over-thirty-two-characters', CORS_ORIGINS: 'http://app.example' }), /HTTPS/);
  assert.equal(validateEnvironment({ NODE_ENV: 'production', SESSION_SECRET: 'strong-random-secret-that-is-over-thirty-two-characters', CORS_ORIGINS: 'https://app.example' }), true);
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

test('workspace bootstrap issues its own authenticated session', async () => {
  const csrf = await get('/api/auth/csrf');
  const response = await write('/api/auth/workspaces', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ workspaceName: 'Company C', email: 'owner-c@test.example', password: 'LongAndUniquePassword_C!2026' }), { 'Content-Type': 'application/json' });
  assert.equal(response.status, 201);
  assert.equal(response.data.user.email, 'owner-c@test.example');
  assert.equal((await get('/api/workspace', response.jar)).data.data.id, response.data.user.workspace.id);
});

test('every workspace API family keeps cross-workspace identifiers isolated', async () => {
  assert.notEqual((await get('/api/workspace', jarB)).data.data.id, ownerA.workspace.id);
  const membersB = await get('/api/workspace/members', jarB);
  assert.equal(membersB.status, 200);
  assert.equal(membersB.data.data.some((member) => member.userId === memberA.userId), false);
  const duplicateInvite = await write('/api/workspace/invitations', jarB, csrfB, 'POST', JSON.stringify({ email: ownerB.user.email, role: 'creator' }), { 'Content-Type': 'application/json' });
  assert.equal(duplicateInvite.status, 409);
  assert.equal(duplicateInvite.data.error, 'Could not create this invitation.');
  assert.equal((await write('/api/workspace/invitations', jarB, csrfB, 'POST', JSON.stringify({ email: 'x@test.example', role: 'creator' }), { 'Content-Type': 'application/json' })).status, 201);
  assert.equal((await write(`/api/workspace/members/${memberA.userId}`, jarB, csrfB, 'PATCH', JSON.stringify({ role: 'reviewer' }), { 'Content-Type': 'application/json' })).status, 404);
  assert.equal((await write(`/api/workspace/members/${memberA.userId}`, jarB, csrfB, 'DELETE')).status, 404);
  assert.deepEqual((await get('/api/reviews', jarB)).data.data, []);
  assert.equal((await write('/api/reviews', jarB, csrfB, 'POST', JSON.stringify({ title: 'Cross tenant', content: 'x' }), { 'Content-Type': 'application/json' })).status, 201);
  assert.equal((await write('/api/reviews/review-a', jarB, csrfB, 'PATCH', JSON.stringify({ status: 'Approved' }), { 'Content-Type': 'application/json' })).status, 404);
  assert.deepEqual((await get('/api/sources', jarB)).data.data, []);
  const form = new FormData(); form.set('name', 'B source'); form.set('category', 'Policies'); form.set('file', new Blob(['private B content'], { type: 'text/plain' }), 'b.txt');
  assert.equal((await write('/api/sources', jarB, csrfB, 'POST', form)).status, 201);
  assert.equal((await write('/api/verification/check/review-a', jarB, csrfB, 'POST')).status, 404);
  assert.equal((await get('/api/auth/sessions', jarB)).status, 200);
  assert.equal((await get('/api/auth/sessions', jarB)).data.data.some((item) => item.userAgent === 'node' && item.workspaceId === ownerA.workspace.id), false);
  const aSessionId = (await get('/api/auth/sessions', jarA)).data.data[0].id;
  assert.equal((await write(`/api/auth/sessions/${aSessionId}`, jarB, csrfB, 'DELETE')).status, 404);
  assert.notEqual((await get('/api/auth/session', jarA)).data.user.id, ownerB.user.userId);
  const wrongWorkspace = await write('/api/auth/login', jarB, csrfB, 'POST', JSON.stringify({ email: 'owner-b@test.example', password: 'LongAndUniquePassword_B!2026', workspaceId: ownerA.workspace.id }), { 'Content-Type': 'application/json' });
  assert.equal(wrongWorkspace.status, 401);
  const foreignInvite = store.createInvitation({ workspaceId: ownerA.workspace.id, email: 'invite-target@test.example', role: 'creator', createdBy: ownerA.user.userId });
  const noTokenAccept = await write('/api/auth/invitations/accept', jarB, csrfB, 'POST', JSON.stringify({ token: 'not-a-real-token', email: foreignInvite.email, password: 'LongAndUniquePassword_X!2026' }), { 'Content-Type': 'application/json' });
  assert.equal(noTokenAccept.status, 400);
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

test('invitation acceptance failures are generic and progressively locked', async () => {
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
  const csrf = await get('/api/auth/csrf');
  let response;
  for (let i = 0; i < 5; i++) {
    response = await write('/api/auth/login', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ email: 'missing-user@test.example', password: 'WrongPassword_2026!!', workspaceId: ownerA.workspace.id }), { 'Content-Type': 'application/json' });
    assert.equal(response.status, 401);
    assert.equal(response.data.error, 'The email, password, or workspace is incorrect.');
  }
  response = await write('/api/auth/login', csrf.jar, csrf.data.token, 'POST', JSON.stringify({ email: 'missing-user@test.example', password: 'WrongPassword_2026!!', workspaceId: ownerA.workspace.id }), { 'Content-Type': 'application/json' });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});
