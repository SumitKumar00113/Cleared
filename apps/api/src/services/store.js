import { randomUUID, randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(process.env.CLEARED_DB_PATH || path.join(dataDir, 'cleared.sqlite'));
const scryptAsync = promisify(scrypt);
db.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, accepted_at TEXT);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS sessions_user_active ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS request_limits (bucket TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS reviews_workspace ON reviews(workspace_id);
CREATE INDEX IF NOT EXISTS sources_workspace ON sources(workspace_id);`);

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
if (!userColumns.has('password_params')) db.exec("ALTER TABLE users ADD COLUMN password_params TEXT NOT NULL DEFAULT '{\"N\":16384,\"r\":8,\"p\":1,\"keyLength\":64}'");

const now = () => new Date().toISOString();
function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
const hashToken = (value) => createHash('sha256').update(value).digest('hex');
const CURRENT_SCRYPT = Object.freeze({ N: 131072, r: 8, p: 1, keyLength: 64 });
const LEGACY_SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });
export const COMMON_PASSWORDS = new Set(['password', 'password123', 'password1234', 'password12345', 'password123456', 'passw0rd', 'welcome', 'welcome1', 'welcome123', 'welcome12345', 'qwerty', 'qwerty123', 'qwerty123456', 'letmein', 'letmein123', 'letmein12345', 'admin', 'admin123', 'admin1234567', 'changeme', 'changeme123', 'changeme12345', 'iloveyou', 'iloveyou123', 'iloveyou12345', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'trustno1', 'abc123', 'login', 'master', 'shadow', 'ashley', 'michael', 'whatever', 'freedom', 'hello', 'company', 'cleared', 'cleared123456']);
const COMMON_PASSWORD_BASES = ['password', 'passw0rd', 'welcome', 'qwerty', 'letmein', 'admin', 'changeme', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'trustno1', 'abc123', 'login', 'master', 'shadow', 'whatever', 'freedom', 'company', 'cleared'];
export function isCommonPassword(password) {
  const lower = String(password || '').toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  const compact = lower.replace(/[^a-z0-9]/g, '');
  return COMMON_PASSWORD_BASES.some((base) => compact.startsWith(base) && /^(\d{1,12}|20\d{2})?$/.test(compact.slice(base.length)));
}
async function derivePassword(password, salt, parameters) {
  return Buffer.from(await scryptAsync(password, salt, parameters.keyLength, { N: parameters.N, r: parameters.r, p: parameters.p, maxmem: 256 * 1024 * 1024 }));
}
async function hashPassword(password, salt = randomBytes(16).toString('hex'), parameters = CURRENT_SCRYPT) {
  return { salt, hash: (await derivePassword(password, salt, parameters)).toString('hex'), parameters };
}
async function verifyPassword(password, user) {
  let parameters;
  try { parameters = user.password_params ? JSON.parse(user.password_params) : LEGACY_SCRYPT; } catch { parameters = LEGACY_SCRYPT; }
  const actual = await derivePassword(password, user.password_salt, parameters);
  const expected = Buffer.from(user.password_hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createWorkspaceAccount({ workspaceName, email, password }) {
  const credentials = await hashPassword(password);
  return transaction(() => {
    const workspace = { id: randomUUID(), name: workspaceName.trim(), createdAt: now() };
    const userId = randomUUID();
    db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(workspace.id, workspace.name, workspace.createdAt);
    db.prepare('INSERT INTO users(id,email,password_hash,password_salt,password_params,created_at) VALUES(?,?,?,?,?,?)').run(userId, email.trim().toLowerCase(), credentials.hash, credentials.salt, JSON.stringify(credentials.parameters), now());
    db.prepare('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)').run(workspace.id, userId, 'owner');
    return { workspace, user: getMembership(workspace.id, userId) };
  });
}

export function getUserByEmail(email) { return db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase()); }
export async function authenticateUser(email, password) {
  const user = getUserByEmail(email);
  if (!user || !(await verifyPassword(String(password || ''), user))) return null;
  const parameters = JSON.parse(user.password_params || JSON.stringify(LEGACY_SCRYPT));
  if (JSON.stringify(parameters) !== JSON.stringify(CURRENT_SCRYPT)) {
    const upgraded = await hashPassword(String(password || ''));
    db.prepare('UPDATE users SET password_hash=?,password_salt=?,password_params=? WHERE id=?').run(upgraded.hash, upgraded.salt, JSON.stringify(upgraded.parameters), user.id);
  }
  return user;
}
export function getMembership(workspaceId, userId) {
  return db.prepare(`SELECT u.id AS userId,u.email,w.id AS workspaceId,w.name AS workspaceName,m.role
    FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id
    WHERE m.workspace_id=? AND m.user_id=?`).get(workspaceId, userId) || null;
}
export function getUserWorkspaces(userId) {
  return db.prepare(`SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY w.created_at`).all(userId);
}
export function getWorkspace(workspaceId) { return db.prepare('SELECT id,name,created_at AS createdAt FROM workspaces WHERE id=?').get(workspaceId) || null; }
export function createInvitation({ workspaceId, email, role, createdBy }) {
  const token = randomBytes(32).toString('base64url');
  const invitation = { id: randomUUID(), email: email.trim().toLowerCase(), role, token, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
  db.prepare('INSERT INTO invitations(id,workspace_id,email,role,token_hash,created_by,expires_at) VALUES(?,?,?,?,?,?,?)').run(invitation.id, workspaceId, invitation.email, role, hashToken(token), createdBy, invitation.expiresAt);
  return invitation;
}
export async function acceptInvitation({ token, email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const invite = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL').get(hashToken(token));
  if (!invite || new Date(invite.expires_at).getTime() < Date.now() || invite.email !== normalizedEmail) return { error: 'The invitation details are invalid or expired.' };
  const existing = getUserByEmail(normalizedEmail);
  if (existing && !(await verifyPassword(String(password || ''), existing))) return { error: 'The invitation details are invalid or expired.' };
  if (!existing && (String(password || '').length < 12 || isCommonPassword(password))) return { error: 'Choose a less common password with at least 12 characters.' };
  const credentials = existing ? null : await hashPassword(password);
  return transaction(() => {
    const row = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL').get(hashToken(token));
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return { error: 'This invitation is invalid or has expired.' };
    if (row.email !== normalizedEmail) return { error: 'Use the email address this invitation was sent to.' };

    let account = getUserByEmail(normalizedEmail);
    if (account) {
      if (getMembership(row.workspace_id, account.id)) return { error: 'This account already belongs to the workspace.' };
    } else {
      const userId = randomUUID();
      db.prepare('INSERT INTO users(id,email,password_hash,password_salt,password_params,created_at) VALUES(?,?,?,?,?,?)').run(userId, row.email, credentials.hash, credentials.salt, JSON.stringify(credentials.parameters), now());
      account = { id: userId };
    }

    db.prepare('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)').run(row.workspace_id, account.id, row.role);
    const accepted = db.prepare('UPDATE invitations SET accepted_at=? WHERE id=? AND accepted_at IS NULL').run(now(), row.id);
    if (!accepted.changes) return { error: 'This invitation has already been used.' };
    return { user: getMembership(row.workspace_id, account.id) };
  });
}
const SESSION_MS = 12 * 60 * 60 * 1000;
export const hashSessionId = (id) => createHash('sha256').update(id).digest('hex');
export function createSession({ id, userId, workspaceId, userAgent = '' }) {
  const createdAt = now();
  db.prepare('INSERT INTO sessions(id,user_id,workspace_id,expires_at,user_agent,created_at,last_used_at) VALUES(?,?,?,?,?,?,?)')
    .run(hashSessionId(id), userId, workspaceId, new Date(Date.now() + SESSION_MS).toISOString(), String(userAgent).slice(0, 512), createdAt, createdAt);
}
export function getSession(id) {
  const hashed = hashSessionId(id);
  const row = db.prepare("SELECT s.*,u.email,w.name AS workspaceName,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=s.workspace_id JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>? ").get(hashed, now());
  if (!row) return null;
  db.prepare('UPDATE sessions SET last_used_at=? WHERE id=?').run(now(), hashed);
  return { userId: row.user_id, workspaceId: row.workspace_id, workspaceName: row.workspaceName, email: row.email, role: row.role, expires: new Date(row.expires_at).getTime() };
}
export function revokeSession(id) { db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now(), hashSessionId(id)); }
export function revokeUserSessions(userId) { return db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), userId).changes; }
export function listActiveSessions(userId) { return db.prepare('SELECT id,workspace_id AS workspaceId,user_agent AS userAgent,created_at AS createdAt,last_used_at AS lastUsedAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY last_used_at DESC').all(userId, now()); }
export function revokeListedSession(userId, hashedId) { return db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL').run(now(), userId, hashedId).changes > 0; }
export function checkAuthLimit(keys) {
  const timestamp = Date.now();
  const records = keys.map((bucket) => db.prepare('SELECT * FROM auth_attempts WHERE bucket=?').get(bucket)).filter(Boolean);
  const active = records.find((row) => row.locked_until > timestamp);
  return active ? Math.ceil((active.locked_until - timestamp) / 1000) : 0;
}
export function recordAuthFailure(keys) {
  const timestamp = Date.now();
  for (const bucket of new Set(keys)) {
    const row = db.prepare('SELECT * FROM auth_attempts WHERE bucket=?').get(bucket);
    const failures = row && timestamp - row.window_started_at < 15 * 60 * 1000 ? row.failures + 1 : 1;
    const lockedUntil = failures >= 5 ? timestamp + Math.min(60 * 60 * 1000, 15 * 60 * 1000 * (2 ** Math.floor((failures - 5) / 3))) : 0;
    db.prepare('INSERT INTO auth_attempts(bucket,failures,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(bucket) DO UPDATE SET failures=excluded.failures,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until').run(bucket, failures, row && timestamp - row.window_started_at < 15 * 60 * 1000 ? row.window_started_at : timestamp, lockedUntil);
  }
}
export function clearAuthFailures(keys) { for (const bucket of new Set(keys)) db.prepare('DELETE FROM auth_attempts WHERE bucket=?').run(bucket); }
export function consumeRequestLimit(keys, maxRequests, windowMs) {
  const timestamp = Date.now();
  let wait = 0;
  for (const bucket of new Set(keys)) {
    const row = db.prepare('SELECT * FROM request_limits WHERE bucket=?').get(bucket);
    const fresh = !row || timestamp - row.window_started_at >= windowMs;
    const count = fresh ? 0 : row.requests;
    if (count >= maxRequests) wait = Math.max(wait, Math.ceil((windowMs - (timestamp - row.window_started_at)) / 1000));
    else db.prepare('INSERT INTO request_limits(bucket,requests,window_started_at) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET requests=excluded.requests,window_started_at=excluded.window_started_at').run(bucket, count + 1, fresh ? timestamp : row.window_started_at);
  }
  return wait;
}
export function listMembers(workspaceId) {
  return db.prepare(`SELECT u.id AS userId,u.email,m.role,u.created_at AS joinedAt
    FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.created_at`).all(workspaceId);
}
export function getWorkspaceMemberByEmail(workspaceId, email) {
  return db.prepare(`SELECT u.id AS userId,u.email,m.role FROM memberships m
    JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?`)
    .get(workspaceId, String(email || '').trim().toLowerCase()) || null;
}
export function changeMemberRole(workspaceId, userId, role) {
  const result = db.prepare("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=? AND role!='owner'").run(role, workspaceId, userId);
  return result.changes ? getMembership(workspaceId, userId) : null;
}
export function removeMember(workspaceId, userId) {
  return db.prepare("DELETE FROM memberships WHERE workspace_id=? AND user_id=? AND role!='owner'").run(workspaceId, userId).changes > 0;
}
export function saveReview(workspaceId, record) { db.prepare('INSERT OR REPLACE INTO reviews(id,workspace_id,data) VALUES(?,?,?)').run(record.id, workspaceId, JSON.stringify(record)); }
export function getReviews(workspaceId) { return db.prepare('SELECT data FROM reviews WHERE workspace_id=? ORDER BY rowid DESC').all(workspaceId).map((row) => JSON.parse(row.data)); }
export function getReview(workspaceId, id) { const row = db.prepare('SELECT data FROM reviews WHERE workspace_id=? AND id=?').get(workspaceId, id); return row ? JSON.parse(row.data) : null; }
export function saveSource(workspaceId, record) { db.prepare('INSERT OR REPLACE INTO sources(id,workspace_id,data) VALUES(?,?,?)').run(record.id, workspaceId, JSON.stringify(record)); }
export function getSources(workspaceId) { return db.prepare('SELECT data FROM sources WHERE workspace_id=? ORDER BY rowid DESC').all(workspaceId).map((row) => JSON.parse(row.data)); }
export function closeStore() { db.close(); }
