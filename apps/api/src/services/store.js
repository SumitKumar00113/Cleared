import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(process.env.CLEARED_DB_PATH || path.join(dataDir, 'cleared.sqlite'));
db.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, accepted_at TEXT);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS reviews_workspace ON reviews(workspace_id);
CREATE INDEX IF NOT EXISTS sources_workspace ON sources(workspace_id);`);

const now = () => new Date().toISOString();
function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
const hashToken = (value) => createHash('sha256').update(value).digest('hex');
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, salt, hash) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createWorkspaceAccount({ workspaceName, email, password }) {
  return transaction(() => {
    const workspace = { id: randomUUID(), name: workspaceName.trim(), createdAt: now() };
    const userId = randomUUID();
    const credentials = hashPassword(password);
    db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(workspace.id, workspace.name, workspace.createdAt);
    db.prepare('INSERT INTO users(id,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)').run(userId, email.trim().toLowerCase(), credentials.hash, credentials.salt, now());
    db.prepare('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)').run(workspace.id, userId, 'owner');
    return { workspace, user: getMembership(workspace.id, userId) };
  });
}

export function getUserByEmail(email) { return db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase()); }
export function authenticateUser(email, password) {
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(String(password || ''), user.password_salt, user.password_hash)) return null;
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
export function acceptInvitation({ token, email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return transaction(() => {
    const row = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL').get(hashToken(token));
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return { error: 'This invitation is invalid or has expired.' };
    if (row.email !== normalizedEmail) return { error: 'Use the email address this invitation was sent to.' };

    let account = getUserByEmail(normalizedEmail);
    if (account) {
      if (!verifyPassword(String(password || ''), account.password_salt, account.password_hash)) {
        return { error: 'The invitation or sign-in details are incorrect.' };
      }
      if (getMembership(row.workspace_id, account.id)) return { error: 'This account already belongs to the workspace.' };
    } else {
      if (String(password || '').length < 12) return { error: 'Use a password with at least 12 characters.' };
      const userId = randomUUID(); const credentials = hashPassword(password);
      db.prepare('INSERT INTO users(id,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)').run(userId, row.email, credentials.hash, credentials.salt, now());
      account = { id: userId };
    }

    db.prepare('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)').run(row.workspace_id, account.id, row.role);
    const accepted = db.prepare('UPDATE invitations SET accepted_at=? WHERE id=? AND accepted_at IS NULL').run(now(), row.id);
    if (!accepted.changes) return { error: 'This invitation has already been used.' };
    return { user: getMembership(row.workspace_id, account.id) };
  });
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
