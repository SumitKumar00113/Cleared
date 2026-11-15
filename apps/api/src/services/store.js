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
const phase3Migration = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_events'").get();
if (!phase3Migration) {
  const databasePath=db.location();
  if (databasePath && databasePath !== ':memory:') {
    const backupPath = `${databasePath}.phase3-${new Date().toISOString().replace(/[:.]/g, '-')}.bak.sqlite`;
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    console.info(`[migration] SQLite backup created at ${backupPath}`);
  }
}
const scryptAsync = promisify(scrypt);
const SCRYPT_CONCURRENCY = 2;
const SCRYPT_MAXMEM = 160 * 1024 * 1024;
let activeScrypt = 0;
let peakActiveScrypt = 0;
const scryptQueue = [];
async function withScryptSlot(operation) {
  if (activeScrypt >= SCRYPT_CONCURRENCY) await new Promise((resolve) => scryptQueue.push(resolve));
  activeScrypt += 1;
  peakActiveScrypt = Math.max(peakActiveScrypt, activeScrypt);
  try { return await operation(); }
  finally { activeScrypt -= 1; scryptQueue.shift()?.(); }
}
export function passwordHashingStats() { return { active: activeScrypt, queued: scryptQueue.length, peak: peakActiveScrypt, concurrencyLimit: SCRYPT_CONCURRENCY, maxmemBytes: SCRYPT_MAXMEM }; }
db.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, mfa_secret_enc TEXT, mfa_pending_secret_enc TEXT, mfa_enabled INTEGER NOT NULL DEFAULT 0, mfa_last_step INTEGER NOT NULL DEFAULT -1);
CREATE TABLE IF NOT EXISTS memberships (workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, accepted_at TEXT);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stored_files (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), owner_id TEXT NOT NULL REFERENCES users(id), uploader_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL CHECK(purpose IN ('review','source')), resource_id TEXT NOT NULL, original_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, checksum TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, scan_status TEXT NOT NULL DEFAULT 'quarantined' CHECK(scan_status IN ('quarantined','clean','rejected')), scan_engine TEXT, uploaded_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS source_versions (source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, version INTEGER NOT NULL, file_id TEXT REFERENCES stored_files(id), owner_id TEXT NOT NULL REFERENCES users(id), uploader_id TEXT NOT NULL REFERENCES users(id), checksum TEXT NOT NULL, uploaded_at TEXT NOT NULL, expires_at TEXT, PRIMARY KEY(source_id,version));
CREATE TABLE IF NOT EXISTS collection_access (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL, allowed_roles TEXT NOT NULL, allowed_user_ids TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,category));
CREATE INDEX IF NOT EXISTS stored_files_workspace ON stored_files(workspace_id, id);
CREATE INDEX IF NOT EXISTS source_versions_file ON source_versions(file_id);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, revoked_at TEXT, mfa_verified INTEGER NOT NULL DEFAULT 0, mfa_verified_at TEXT, recent_auth_at TEXT);
CREATE INDEX IF NOT EXISTS sessions_user_active ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS request_limits (bucket TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS account_action_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('email_verify','password_reset','email_change','account_unlock')), token_hash TEXT NOT NULL UNIQUE, target_email TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
CREATE INDEX IF NOT EXISTS account_action_tokens_owner ON account_action_tokens(user_id,kind,expires_at);
CREATE TABLE IF NOT EXISTS mfa_challenges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT, PRIMARY KEY(user_id,code_hash));
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,review_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT);
CREATE INDEX IF NOT EXISTS notifications_inbox ON notifications(workspace_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS workspace_settings (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,ai_check_enabled INTEGER NOT NULL DEFAULT 0,updated_by TEXT REFERENCES users(id),updated_at TEXT);
CREATE TABLE IF NOT EXISTS verification_jobs (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,review_id TEXT NOT NULL,revision_id TEXT NOT NULL,requested_by TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),attempt_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,available_at TEXT,started_at TEXT,finished_at TEXT,error_code TEXT,passage_ids TEXT NOT NULL DEFAULT '[]',characters_sent INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS verification_jobs_active_revision ON verification_jobs(workspace_id,review_id,revision_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS verification_usage (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,usage_day TEXT NOT NULL,jobs INTEGER NOT NULL DEFAULT 0,characters INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,usage_day));
CREATE INDEX IF NOT EXISTS reviews_workspace ON reviews(workspace_id);
CREATE INDEX IF NOT EXISTS sources_workspace ON sources(workspace_id);`);

const actionTokenSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='account_action_tokens'").get()?.sql || '';
if (!actionTokenSql.includes('account_unlock')) {
  db.exec(`BEGIN IMMEDIATE;
    DROP INDEX IF EXISTS account_action_tokens_owner;
    ALTER TABLE account_action_tokens RENAME TO account_action_tokens_legacy;
    CREATE TABLE account_action_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('email_verify','password_reset','email_change','account_unlock')), token_hash TEXT NOT NULL UNIQUE, target_email TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
    INSERT INTO account_action_tokens SELECT * FROM account_action_tokens_legacy;
    DROP TABLE account_action_tokens_legacy;
    CREATE INDEX account_action_tokens_owner ON account_action_tokens(user_id,kind,expires_at);
    COMMIT;`);
}

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
if (!userColumns.has('password_params')) db.exec("ALTER TABLE users ADD COLUMN password_params TEXT NOT NULL DEFAULT '{\"N\":16384,\"r\":8,\"p\":1,\"keyLength\":64}'");
if (!userColumns.has('email_verified')) db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1');
if (!userColumns.has('mfa_secret_enc')) db.exec('ALTER TABLE users ADD COLUMN mfa_secret_enc TEXT');
if (!userColumns.has('mfa_pending_secret_enc')) db.exec('ALTER TABLE users ADD COLUMN mfa_pending_secret_enc TEXT');
if (!userColumns.has('mfa_enabled')) db.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0');
if (!userColumns.has('mfa_last_step')) db.exec('ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT -1');
const sessionColumns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((column) => column.name));
if (!sessionColumns.has('mfa_verified')) db.exec('ALTER TABLE sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0');
if (!sessionColumns.has('mfa_verified_at')) db.exec('ALTER TABLE sessions ADD COLUMN mfa_verified_at TEXT');
if (!sessionColumns.has('recent_auth_at')) db.exec('ALTER TABLE sessions ADD COLUMN recent_auth_at TEXT');

const now = () => new Date().toISOString();
// Preserve pre-Phase-2 source metadata as a quarantined metadata-only first version.
const sourceColumnsAtStartup=new Set(db.prepare('PRAGMA table_info(sources)').all().map((column)=>column.name));
for (const row of (sourceColumnsAtStartup.has('data')?db.prepare('SELECT id,workspace_id AS workspaceId,data FROM sources').all():[])) {
  const source = JSON.parse(row.data);
  if (db.prepare('SELECT 1 FROM source_versions WHERE source_id=? LIMIT 1').get(row.id)) continue;
  const ownerId = source.ownerId || db.prepare('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND lower(u.email)=lower(?)').get(row.workspaceId, source.owner)?.id;
  if (!ownerId || !db.prepare('SELECT 1 FROM users WHERE id=?').get(ownerId)) continue;
  const uploaderId = source.uploaderId && db.prepare('SELECT 1 FROM users WHERE id=?').get(source.uploaderId) ? source.uploaderId : ownerId;
  const checksum = createHash('sha256').update(String(source.text || '')).digest('hex');
  db.prepare('INSERT INTO source_versions(source_id,workspace_id,version,file_id,owner_id,uploader_id,checksum,uploaded_at,expires_at) VALUES(?,?,?,NULL,?,?,?,?,?)').run(row.id,row.workspaceId,source.version || 1,ownerId,uploaderId,checksum,source.uploadedAt || source.updated || now(),source.expiresAt || null);
}

// Phase 3 schema conversion. A standalone SQLite snapshot is taken before any
// existing database is changed. The conversion keeps its old rows available
// for the down migration and converts them into workspace-scoped relations.
if (!phase3Migration) {
  db.exec(`BEGIN IMMEDIATE;
    DROP INDEX IF EXISTS reviews_workspace;
    DROP INDEX IF EXISTS sources_workspace;
    DROP INDEX IF EXISTS source_versions_file;
    ALTER TABLE reviews RENAME TO reviews_legacy_phase3;
    ALTER TABLE sources RENAME TO sources_legacy_phase3;
    CREATE TABLE reviews(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),title TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),owner_email TEXT NOT NULL,team TEXT NOT NULL DEFAULT 'Unassigned',status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,current_revision_id TEXT REFERENCES review_revisions(id) DEFERRABLE INITIALLY DEFERRED,file_id TEXT,file_name TEXT,findings_count INTEGER NOT NULL DEFAULT 0,verified_at TEXT);
    CREATE TABLE review_revisions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,revision INTEGER NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,editor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,locked INTEGER NOT NULL DEFAULT 0,UNIQUE(review_id,revision));
    CREATE TABLE claims(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,revision_id TEXT NOT NULL REFERENCES review_revisions(id) ON DELETE CASCADE,claim_text TEXT NOT NULL,verdict TEXT NOT NULL,source_id TEXT,source_version INTEGER,source_name TEXT,evidence TEXT,explanation TEXT,created_at TEXT NOT NULL,mode TEXT,model_name TEXT,prompt_version TEXT,passage_id TEXT,job_id TEXT);
    CREATE TABLE findings(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,revision_id TEXT NOT NULL REFERENCES review_revisions(id) ON DELETE CASCADE,claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,source_id TEXT,source_version INTEGER,created_at TEXT NOT NULL,mode TEXT,model_name TEXT,prompt_version TEXT,passage_id TEXT,job_id TEXT);
    CREATE TABLE decisions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,revision_id TEXT NOT NULL REFERENCES review_revisions(id),actor_id TEXT NOT NULL REFERENCES users(id),decision TEXT NOT NULL CHECK(decision IN ('Approved','Rejected','Needs changes')),created_at TEXT NOT NULL);
    CREATE TABLE sources(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),name TEXT NOT NULL,category TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),owner_email TEXT NOT NULL,uploader_id TEXT NOT NULL REFERENCES users(id),uploader_email TEXT NOT NULL,type TEXT NOT NULL DEFAULT '',file_name TEXT NOT NULL DEFAULT '',size INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,deleted_at TEXT);
    ALTER TABLE source_versions RENAME TO source_versions_legacy_phase3;
    CREATE TABLE source_versions(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,version INTEGER NOT NULL,file_id TEXT REFERENCES stored_files(id),owner_id TEXT NOT NULL REFERENCES users(id),uploader_id TEXT NOT NULL REFERENCES users(id),checksum TEXT NOT NULL,uploaded_at TEXT NOT NULL,expires_at TEXT,scan_status TEXT NOT NULL DEFAULT 'quarantined' CHECK(scan_status IN ('quarantined','clean','rejected')),PRIMARY KEY(source_id,version));
    CREATE TABLE source_passages(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),source_id TEXT NOT NULL,version INTEGER NOT NULL,passage_number INTEGER NOT NULL,text TEXT NOT NULL,content_hash TEXT NOT NULL,FOREIGN KEY(source_id,version) REFERENCES source_versions(source_id,version) ON DELETE CASCADE);
    CREATE TABLE audit_events(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT,occurred_at TEXT NOT NULL,request_origin TEXT,details TEXT NOT NULL DEFAULT '{}',previous_hash TEXT,event_hash TEXT);
    CREATE INDEX reviews_workspace ON reviews(workspace_id,created_at);
    CREATE INDEX review_revisions_workspace ON review_revisions(workspace_id,review_id,revision);
    CREATE INDEX claims_workspace ON claims(workspace_id,review_id,revision_id);
    CREATE INDEX findings_workspace ON findings(workspace_id,review_id,revision_id);
    CREATE INDEX decisions_workspace ON decisions(workspace_id,review_id,created_at);
    CREATE INDEX sources_workspace ON sources(workspace_id,updated_at);
    CREATE INDEX source_versions_file ON source_versions(workspace_id,file_id);
    CREATE INDEX source_passages_workspace ON source_passages(workspace_id,source_id,version);
    CREATE INDEX audit_events_workspace ON audit_events(workspace_id,occurred_at,id);
    CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events is append-only'); END;
    CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events is append-only'); END;
  `);
  for (const row of db.prepare('SELECT id,workspace_id AS workspaceId,data FROM reviews_legacy_phase3').all()) {
    const review = JSON.parse(row.data), at = review.date || now(), editor = review.ownerId;
    if (!editor || !db.prepare('SELECT 1 FROM users WHERE id=?').get(editor)) continue;
    const revisionId = randomUUID(), content = String(review.content || ''), contentHash = createHash('sha256').update(content).digest('hex');
    db.prepare('INSERT INTO reviews(id,workspace_id,title,owner_id,owner_email,team,status,created_at,updated_at,current_revision_id,file_id,file_name,findings_count,verified_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(review.id,row.workspaceId,review.title || '(untitled)',editor,review.owner || '',review.team || 'Unassigned',review.status || 'In review',at,review.updatedAt || at,revisionId,review.fileId || null,review.fileName || null,Number(review.findings || 0),review.verifiedAt || null);
    db.prepare('INSERT INTO review_revisions(id,workspace_id,review_id,revision,content,content_hash,editor_id,created_at,locked) VALUES(?,?,?,?,?,?,?,?,0)').run(revisionId,row.workspaceId,review.id,1,content,contentHash,editor,at);
    const auditId = randomUUID(); db.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,action,target_type,target_id,occurred_at,details) VALUES(?,?,?,?,?,?,?,?)').run(auditId,row.workspaceId,editor,'review.submitted','review',review.id,at,JSON.stringify({revision:1}));
    for (const claim of review.claimResults || []) {
      const claimId = randomUUID();
      db.prepare('INSERT INTO claims(id,workspace_id,review_id,revision_id,claim_text,verdict,source_id,source_version,source_name,evidence,explanation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(claimId,row.workspaceId,review.id,revisionId,String(claim.claim || ''),claim.verdict || 'Not enough evidence',claim.sourceId || null,claim.sourceVersion || null,claim.sourceName || null,claim.evidence || null,claim.explanation || '',review.verifiedAt || at);
      if (claim.verdict !== 'Supported') db.prepare('INSERT INTO findings(id,workspace_id,review_id,revision_id,claim_id,source_id,source_version,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),row.workspaceId,review.id,revisionId,claimId,claim.sourceId || null,claim.sourceVersion || null,review.verifiedAt || at);
    }
  }
  for (const row of db.prepare('SELECT id,workspace_id AS workspaceId,data FROM sources_legacy_phase3').all()) {
    const source = JSON.parse(row.data), owner = source.ownerId || source.uploaderId || db.prepare("SELECT user_id FROM memberships WHERE workspace_id=? ORDER BY role='owner' DESC LIMIT 1").get(row.workspaceId)?.user_id;
    if (!owner) continue;
    const uploader = source.uploaderId || owner, uploadedAt = source.uploadedAt || source.updated || now();
    const email = (id) => db.prepare('SELECT email FROM users WHERE id=?').get(id)?.email || '';
    db.prepare('INSERT INTO sources(id,workspace_id,name,category,owner_id,owner_email,uploader_id,uploader_email,type,file_name,size,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.workspaceId,source.name || '(legacy source)',source.category || 'General',owner,email(owner),uploader,email(uploader),source.type || '',source.fileName || '',Number(source.size || 0),uploadedAt);
    const versions = db.prepare('SELECT * FROM source_versions_legacy_phase3 WHERE source_id=? ORDER BY version').all(row.id);
    for (const version of versions) db.prepare('INSERT INTO source_versions(source_id,workspace_id,version,file_id,owner_id,uploader_id,checksum,uploaded_at,expires_at,scan_status) VALUES(?,?,?,?,?,?,?,?,? ,?)').run(version.source_id,version.workspace_id,version.version,version.file_id,version.owner_id,version.uploader_id,version.checksum,version.uploaded_at,version.expires_at,'quarantined');
    if (!versions.length) {
      const checksum=createHash('sha256').update(String(source.text || '')).digest('hex');
      db.prepare('INSERT INTO source_versions(source_id,workspace_id,version,file_id,owner_id,uploader_id,checksum,uploaded_at,expires_at,scan_status) VALUES(?,?,1,NULL,?,?,?,?,? ,?)').run(row.id,row.workspaceId,owner,uploader,checksum,uploadedAt,source.expiresAt || null,'quarantined');
    }
    if (source.text) {
      const version = versions.at(-1)?.version || 1;
      const passages = String(source.text).split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
      passages.forEach((text,index)=>db.prepare('INSERT INTO source_passages(id,workspace_id,source_id,version,passage_number,text,content_hash) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),row.workspaceId,row.id,version,index+1,text,createHash('sha256').update(text).digest('hex')));
    }
  }
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_action_events'").get()){
    for (const event of db.prepare('SELECT * FROM file_action_events').all()) db.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,action,target_type,target_id,occurred_at,details) VALUES(?,?,?,?,?,?,?,?)').run(event.id,event.workspace_id,event.actor_id,`file.${event.action}`,'file',event.file_id,event.created_at,event.details);
    db.exec('DROP TABLE file_action_events;');
  }
  db.exec('COMMIT');
} else db.exec('DROP TABLE IF EXISTS file_action_events; DROP INDEX IF EXISTS file_action_events_workspace;');

const claimColumns=new Set(db.prepare('PRAGMA table_info(claims)').all().map((column)=>column.name));
for(const [column,type] of [['mode','TEXT'],['model_name','TEXT'],['prompt_version','TEXT'],['passage_id','TEXT'],['job_id','TEXT']]) if(!claimColumns.has(column)) db.exec(`ALTER TABLE claims ADD COLUMN ${column} ${type}`);
const findingColumns=new Set(db.prepare('PRAGMA table_info(findings)').all().map((column)=>column.name));
for(const [column,type] of [['mode','TEXT'],['model_name','TEXT'],['prompt_version','TEXT'],['passage_id','TEXT'],['job_id','TEXT']]) if(!findingColumns.has(column)) db.exec(`ALTER TABLE findings ADD COLUMN ${column} ${type}`);
const jobColumns=new Set(db.prepare('PRAGMA table_info(verification_jobs)').all().map((column)=>column.name));
if(!jobColumns.has('available_at'))db.exec('ALTER TABLE verification_jobs ADD COLUMN available_at TEXT');
db.prepare('INSERT OR IGNORE INTO workspace_settings(workspace_id,ai_check_enabled) SELECT id,0 FROM workspaces').run();
// Recover jobs interrupted during a process shutdown. They can be claimed again.
db.prepare("UPDATE verification_jobs SET status='queued',started_at=NULL WHERE status='running'").run();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
function canonicalAuditContent(row) {
  let details;
  try { details = JSON.parse(row.details || '{}'); } catch { details = row.details || ''; }
  return JSON.stringify({ id: row.id, workspaceId: row.workspace_id ?? null, actorId: row.actor_id ?? null, action: row.action, targetType: row.target_type, targetId: row.target_id ?? null, occurredAt: row.occurred_at, requestOrigin: row.request_origin ?? null, details: stableValue(details) });
}
function auditHash(previousHash, row) { return createHash('sha256').update(previousHash || '').update('\n').update(canonicalAuditContent(row)).digest('hex'); }

// Add the chain columns to databases created before Phase 4b and backfill in
// insertion order. This migration is idempotent and preserves existing rows.
const auditColumns = new Set(db.prepare('PRAGMA table_info(audit_events)').all().map((column) => column.name));
if (!process.env.CLEARED_SKIP_AUDIT_CHAIN_MIGRATION) {
if ((!auditColumns.has('previous_hash')||!auditColumns.has('event_hash'))&&db.location()&&db.location()!==':memory:') {
  const backupPath=`${db.location()}.audit-chain-${new Date().toISOString().replace(/[:.]/g,'-')}.bak.sqlite`;
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'","''")}'`);
  console.info(`[migration] SQLite audit-chain backup created at ${backupPath}`);
}
if (!auditColumns.has('previous_hash')) db.exec('ALTER TABLE audit_events ADD COLUMN previous_hash TEXT');
if (!auditColumns.has('event_hash')) db.exec('ALTER TABLE audit_events ADD COLUMN event_hash TEXT');
if (db.prepare('SELECT 1 FROM audit_events WHERE event_hash IS NULL OR previous_hash IS NULL LIMIT 1').get()) {
  db.exec('DROP TRIGGER IF EXISTS audit_events_no_update; DROP TRIGGER IF EXISTS audit_events_no_delete; BEGIN IMMEDIATE;');
  const heads = new Map();
  const update = db.prepare('UPDATE audit_events SET previous_hash=?,event_hash=? WHERE id=?');
  for (const row of db.prepare('SELECT rowid AS sequence,* FROM audit_events ORDER BY rowid').all()) {
    const key = row.workspace_id ?? '__unscoped__';
    const previousHash = heads.get(key) || '';
    const eventHash = auditHash(previousHash, row);
    update.run(previousHash, eventHash, row.id);
    heads.set(key, eventHash);
  }
  db.exec(`COMMIT;
    CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events is append-only'); END;
    CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events is append-only'); END;`);
}
}
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
  return withScryptSlot(async () => Buffer.from(await scryptAsync(password, salt, parameters.keyLength, { N: parameters.N, r: parameters.r, p: parameters.p, maxmem: SCRYPT_MAXMEM })));
}
async function hashPassword(password, salt = randomBytes(16).toString('hex'), parameters = CURRENT_SCRYPT) {
  return { salt, hash: (await derivePassword(password, salt, parameters)).toString('hex'), parameters };
}
export async function derivePasswordCredentials(password) { return hashPassword(password); }
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
    db.prepare('INSERT INTO users(id,email,password_hash,password_salt,password_params,created_at,email_verified) VALUES(?,?,?,?,?,?,0)').run(userId, email.trim().toLowerCase(), credentials.hash, credentials.salt, JSON.stringify(credentials.parameters), now());
    db.prepare('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)').run(workspace.id, userId, 'owner');
    return { workspace, user: getMembership(workspace.id, userId) };
  });
}

export function getUserByEmail(email) { return db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase()); }
export function getUserById(userId) { return db.prepare('SELECT * FROM users WHERE id=?').get(userId) || null; }
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
  return db.prepare(`SELECT u.id AS userId,u.email,u.email_verified AS emailVerified,u.mfa_enabled AS mfaEnabled,w.id AS workspaceId,w.name AS workspaceName,m.role
    FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id
    WHERE m.workspace_id=? AND m.user_id=?`).get(workspaceId, userId) || null;
}
export function getUserWorkspaces(userId) {
  return db.prepare(`SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY w.created_at`).all(userId);
}
export function getWorkspace(workspaceId) { return db.prepare('SELECT id,name,created_at AS createdAt FROM workspaces WHERE id=?').get(workspaceId) || null; }
export function getWorkspaceAIEnabled(workspaceId) { return Boolean(db.prepare('SELECT ai_check_enabled FROM workspace_settings WHERE workspace_id=?').get(workspaceId)?.ai_check_enabled); }
export function setWorkspaceAIEnabled(workspaceId,enabled,actorId) {
  db.prepare('INSERT INTO workspace_settings(workspace_id,ai_check_enabled,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET ai_check_enabled=excluded.ai_check_enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(workspaceId,Number(Boolean(enabled)),actorId,now());
  recordAuditEvent({workspaceId,actorId,action:'workspace.ai_setting_changed',targetType:'workspace',targetId:workspaceId,details:{enabled:Boolean(enabled)}});
  return {enabled:Boolean(enabled)};
}
function shapeVerificationJob(row) { return row ? {id:row.id,workspaceId:row.workspace_id,reviewId:row.review_id,revisionId:row.revision_id,requestedBy:row.requested_by,status:row.status,attemptCount:row.attempt_count,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at,errorCode:row.error_code,passageIds:JSON.parse(row.passage_ids||'[]'),charactersSent:row.characters_sent} : null; }
export function createVerificationJob(workspaceId,reviewId,revisionId,requestedBy) {
  const active=db.prepare("SELECT * FROM verification_jobs WHERE workspace_id=? AND review_id=? AND revision_id=? AND status IN ('queued','running')").get(workspaceId,reviewId,revisionId);
  if(active)return {job:shapeVerificationJob(active),created:false};
  const id=randomUUID(),createdAt=now();
  db.prepare("INSERT INTO verification_jobs(id,workspace_id,review_id,revision_id,requested_by,status,created_at,available_at) VALUES(?,?,?,?,?,'queued',?,?)").run(id,workspaceId,reviewId,revisionId,requestedBy,createdAt,createdAt);
  return {job:getVerificationJob(workspaceId,id),created:true};
}
export function getVerificationJob(workspaceId,id) { return shapeVerificationJob(db.prepare('SELECT * FROM verification_jobs WHERE workspace_id=? AND id=?').get(workspaceId,id)); }
export function getNextVerificationJob() {
  return transaction(()=>{
    const row=db.prepare("SELECT * FROM verification_jobs WHERE status='queued' AND COALESCE(available_at,created_at)<=? ORDER BY created_at,id LIMIT 1").get(now());
    if(!row)return null;
    const startedAt=now();
    db.prepare("UPDATE verification_jobs SET status='running',attempt_count=attempt_count+1,started_at=? WHERE id=? AND status='queued'").run(startedAt,row.id);
    return getVerificationJob(row.workspace_id,row.id);
  });
}
export function finishVerificationJob(id,{status,errorCode=null,passageIds=[],charactersSent=0}) {
  const result=db.prepare('UPDATE verification_jobs SET status=?,finished_at=?,error_code=?,passage_ids=?,characters_sent=? WHERE id=? AND status=\'running\'').run(status,now(),errorCode,JSON.stringify(passageIds),charactersSent,id);
  return result.changes>0;
}
export function requeueVerificationJob(id,delayMs=0) { return db.prepare("UPDATE verification_jobs SET status='queued',started_at=NULL,available_at=? WHERE id=? AND status='running'").run(new Date(Date.now()+Math.max(0,delayMs)).toISOString(),id).changes>0; }
export function failQueuedVerificationJob(id,errorCode) { return db.prepare("UPDATE verification_jobs SET status='failed',finished_at=?,error_code=? WHERE id=? AND status='queued'").run(now(),errorCode,id).changes>0; }
export function countDailyVerificationJobs(workspaceId) {
  return db.prepare('SELECT jobs FROM verification_usage WHERE workspace_id=? AND usage_day=?').get(workspaceId,now().slice(0,10))?.jobs||0;
}
export function reserveDailyVerificationJob(workspaceId,maxJobs) {
  const day=now().slice(0,10);
  const result=transaction(()=>{
    const current=db.prepare('SELECT jobs FROM verification_usage WHERE workspace_id=? AND usage_day=?').get(workspaceId,day)?.jobs||0;
    if(current>=maxJobs)return false;
    db.prepare('INSERT INTO verification_usage(workspace_id,usage_day,jobs,characters) VALUES(?,?,1,0) ON CONFLICT(workspace_id,usage_day) DO UPDATE SET jobs=jobs+1').run(workspaceId,day);
    return true;
  });
  return result;
}
export function reserveDailyVerificationCharacters(workspaceId,amount,maxCharacters) {
  const day=now().slice(0,10),chars=Math.max(0,Number(amount)||0);
  const result=transaction(()=>{
    const current=db.prepare('SELECT characters FROM verification_usage WHERE workspace_id=? AND usage_day=?').get(workspaceId,day)?.characters||0;
    if(current+chars>maxCharacters)return false;
    db.prepare('INSERT INTO verification_usage(workspace_id,usage_day,jobs,characters) VALUES(?,?,0,?) ON CONFLICT(workspace_id,usage_day) DO UPDATE SET characters=characters+excluded.characters').run(workspaceId,day,chars);
    return true;
  });
  return result;
}
export function getLatestCleanPassages(workspaceId) {
  return db.prepare(`SELECT p.id AS passageId,p.workspace_id AS workspaceId,p.source_id AS sourceId,p.version,p.text,s.name,s.category,v.expires_at AS expiresAt
    FROM source_passages p JOIN sources s ON s.id=p.source_id AND s.workspace_id=p.workspace_id
    JOIN source_versions v ON v.source_id=p.source_id AND v.version=p.version AND v.workspace_id=p.workspace_id
    LEFT JOIN stored_files f ON f.id=v.file_id AND f.workspace_id=v.workspace_id
    WHERE p.workspace_id=? AND p.version=(SELECT MAX(v2.version) FROM source_versions v2 WHERE v2.workspace_id=p.workspace_id AND v2.source_id=p.source_id)
    AND COALESCE(f.scan_status,v.scan_status)='clean' AND (f.deleted_at IS NULL OR f.id IS NULL) AND s.deleted_at IS NULL
    AND (v.expires_at IS NULL OR v.expires_at>?) ORDER BY p.source_id,p.passage_number`).all(workspaceId,now());
}
export function createActionToken({ userId, kind, targetEmail = null, ttlMs }) {
  const token = randomBytes(32).toString('base64url');
  const timestamp = now();
  const id = randomUUID();
  db.prepare("UPDATE account_action_tokens SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL").run(timestamp, userId, kind);
  db.prepare('INSERT INTO account_action_tokens(id,user_id,kind,token_hash,target_email,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(id, userId, kind, hashToken(token), targetEmail, timestamp, new Date(Date.now() + ttlMs).toISOString());
  return token;
}
export function getActionToken(token, kind) {
  return db.prepare('SELECT * FROM account_action_tokens WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?').get(hashToken(token), kind, now()) || null;
}
export function consumeActionToken(token, kind, callback = () => {}) {
  return transaction(() => {
    const row = getActionToken(token, kind);
    if (!row) return null;
    const result = callback(row);
    const used = db.prepare('UPDATE account_action_tokens SET used_at=? WHERE id=? AND used_at IS NULL').run(now(), row.id);
    return used.changes ? { row, result } : null;
  });
}
export function setEmailVerified(userId) { db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(userId); }
export function changeVerifiedEmail(userId, email) {
  db.prepare('UPDATE users SET email=?,email_verified=1 WHERE id=?').run(String(email).trim().toLowerCase(), userId);
  db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), userId);
}
export function updatePassword(userId, credentials) {
  db.prepare('UPDATE users SET password_hash=?,password_salt=?,password_params=? WHERE id=?').run(credentials.hash, credentials.salt, JSON.stringify(credentials.parameters), userId);
  db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), userId);
}
export function invalidateOtherPasswordResetTokens(userId, exceptId) { db.prepare("UPDATE account_action_tokens SET used_at=? WHERE user_id=? AND kind='password_reset' AND id!=? AND used_at IS NULL").run(now(), userId, exceptId); }
export function savePendingMfaSecret(userId, encryptedSecret) { db.prepare('UPDATE users SET mfa_pending_secret_enc=? WHERE id=?').run(encryptedSecret, userId); }
export function getMfaUser(userId) { return db.prepare('SELECT id,email,mfa_secret_enc AS secretEncrypted,mfa_pending_secret_enc AS pendingSecretEncrypted,mfa_enabled AS enabled,mfa_last_step AS lastStep FROM users WHERE id=?').get(userId) || null; }
export function activateMfa(userId, encryptedSecret, step, recoveryHashes, currentSessionId) {
  return transaction(() => {
    const result = db.prepare('UPDATE users SET mfa_secret_enc=?,mfa_pending_secret_enc=NULL,mfa_enabled=1,mfa_last_step=? WHERE id=? AND mfa_enabled=0').run(encryptedSecret, step, userId);
    if (!result.changes) return false;
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=?').run(userId);
    const insert = db.prepare('INSERT INTO mfa_recovery_codes(user_id,code_hash,created_at) VALUES(?,?,?)');
    for (const codeHash of recoveryHashes) insert.run(userId, codeHash, now());
    const timestamp = now();
    const currentHash = hashSessionId(currentSessionId);
    db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id!=? AND revoked_at IS NULL').run(timestamp, userId, currentHash);
    db.prepare('UPDATE sessions SET mfa_verified=1,mfa_verified_at=?,recent_auth_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL').run(timestamp, timestamp, userId, currentHash);
    return true;
  });
}
export function setSessionMfaVerified(sessionId) {
  const timestamp = now();
  db.prepare('UPDATE sessions SET mfa_verified=1,mfa_verified_at=?,recent_auth_at=? WHERE id=? AND revoked_at IS NULL').run(timestamp, timestamp, hashSessionId(sessionId));
}
export function markSessionRecentlyAuthenticated(sessionId) { db.prepare('UPDATE sessions SET recent_auth_at=? WHERE id=? AND revoked_at IS NULL').run(now(), hashSessionId(sessionId)); }
export function consumeTotpStep(userId, step) { return db.prepare('UPDATE users SET mfa_last_step=? WHERE id=? AND mfa_last_step<? AND mfa_enabled=1').run(step, userId, step).changes > 0; }
export function createMfaChallenge({ token, userId, workspaceId, userAgent = '' }) {
  const createdAt = now();
  db.prepare('INSERT INTO mfa_challenges(id,user_id,workspace_id,token_hash,user_agent,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), userId, workspaceId, hashToken(token), String(userAgent).slice(0, 512), createdAt, new Date(Date.now() + 5 * 60 * 1000).toISOString());
}
export function getMfaChallenge(token) {
  return db.prepare('SELECT c.user_id AS userId,c.workspace_id AS workspaceId,c.user_agent AS userAgent,u.email,u.email_verified AS emailVerified,u.mfa_enabled AS mfaEnabled,u.mfa_secret_enc AS secretEncrypted,u.mfa_last_step AS lastStep FROM mfa_challenges c JOIN users u ON u.id=c.user_id JOIN memberships m ON m.workspace_id=c.workspace_id AND m.user_id=c.user_id WHERE c.token_hash=? AND c.used_at IS NULL AND c.expires_at>? AND u.mfa_enabled=1').get(hashToken(token), now()) || null;
}
export function completeMfaChallenge(token, { step = null, recoveryHash = null } = {}) {
  return transaction(() => {
    const row = db.prepare('SELECT c.*,u.email,u.mfa_last_step,w.name AS workspaceName,m.role FROM mfa_challenges c JOIN users u ON u.id=c.user_id JOIN workspaces w ON w.id=c.workspace_id JOIN memberships m ON m.workspace_id=c.workspace_id AND m.user_id=c.user_id WHERE c.token_hash=? AND c.used_at IS NULL AND c.expires_at>? AND u.mfa_enabled=1').get(hashToken(token), now());
    if (!row) return null;
    if (recoveryHash) {
      const used = db.prepare('UPDATE mfa_recovery_codes SET used_at=? WHERE user_id=? AND code_hash=? AND used_at IS NULL').run(now(), row.user_id, recoveryHash);
      if (!used.changes) return null;
    } else {
      const updated = db.prepare('UPDATE users SET mfa_last_step=? WHERE id=? AND mfa_last_step<?').run(step, row.user_id, step);
      if (!updated.changes || step <= row.mfa_last_step) return null;
    }
    const consumed = db.prepare('UPDATE mfa_challenges SET used_at=? WHERE id=? AND used_at IS NULL').run(now(), row.id);
    if (!consumed.changes) return null;
    return { userId: row.user_id, workspaceId: row.workspace_id, workspaceName: row.workspaceName, email: row.email, emailVerified: true, mfaEnabled: true, mfaVerified: true, userAgent: row.user_agent };
  });
}
export function deleteSource(workspaceId, sourceId, actorId = null, requestOrigin = null) { const changed=db.prepare('DELETE FROM sources WHERE workspace_id=? AND id=?').run(workspaceId, sourceId).changes > 0; if(changed)recordAuditEvent({workspaceId,actorId,action:'source.deleted',targetType:'source',targetId:sourceId,requestOrigin}); return changed; }
export function createInvitation({ workspaceId, email, role, createdBy }) {
  const token = randomBytes(32).toString('base64url');
  const invitation = { id: randomUUID(), email: email.trim().toLowerCase(), role, token, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
  db.prepare('INSERT INTO invitations(id,workspace_id,email,role,token_hash,created_by,expires_at) VALUES(?,?,?,?,?,?,?)').run(invitation.id, workspaceId, invitation.email, role, hashToken(token), createdBy, invitation.expiresAt);
  return invitation;
}
export function revokeInvitation(invitationId) { db.prepare('UPDATE invitations SET accepted_at=? WHERE id=? AND accepted_at IS NULL').run(now(), invitationId); }
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
      db.prepare('INSERT INTO users(id,email,password_hash,password_salt,password_params,created_at,email_verified) VALUES(?,?,?,?,?,?,1)').run(userId, row.email, credentials.hash, credentials.salt, JSON.stringify(credentials.parameters), now());
      account = { id: userId };
    }

    db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(account.id);

    db.prepare('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)').run(row.workspace_id, account.id, row.role);
    const accepted = db.prepare('UPDATE invitations SET accepted_at=? WHERE id=? AND accepted_at IS NULL').run(now(), row.id);
    if (!accepted.changes) return { error: 'This invitation has already been used.' };
    return { user: getMembership(row.workspace_id, account.id) };
  });
}
const SESSION_MS = 12 * 60 * 60 * 1000;
export const hashSessionId = (id) => createHash('sha256').update(id).digest('hex');
export function createSession({ id, userId, workspaceId, userAgent = '', mfaVerified = false, expiresAt = new Date(Date.now() + SESSION_MS).toISOString() }) {
  const createdAt = now();
  db.prepare('INSERT INTO sessions(id,user_id,workspace_id,expires_at,user_agent,created_at,last_used_at,mfa_verified,mfa_verified_at,recent_auth_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(hashSessionId(id), userId, workspaceId, expiresAt, String(userAgent).slice(0, 512), createdAt, createdAt, Number(mfaVerified), mfaVerified ? createdAt : null, createdAt);
}
export function getSession(id, { touch = true } = {}) {
  const hashed = hashSessionId(id);
  const row = db.prepare("SELECT s.*,u.email,u.email_verified AS emailVerified,u.mfa_enabled AS mfaEnabled,w.name AS workspaceName,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=s.workspace_id JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>? ").get(hashed, now());
  if (!row) return null;
  if (touch) db.prepare('UPDATE sessions SET last_used_at=? WHERE id=?').run(now(), hashed);
  return { userId: row.user_id, workspaceId: row.workspace_id, workspaceName: row.workspaceName, email: row.email, role: row.role, emailVerified: Boolean(row.emailVerified), mfaEnabled: Boolean(row.mfaEnabled), mfaVerified: Boolean(row.mfa_verified), mfaVerifiedAt: row.mfa_verified_at, recentAuthAt: row.recent_auth_at, expires: new Date(row.expires_at).getTime() };
}
export function revokeSession(id) { db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now(), hashSessionId(id)); }
export function revokeUserSessions(userId) { return db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), userId).changes; }
export function listActiveSessions(userId) { return db.prepare('SELECT id,workspace_id AS workspaceId,user_agent AS userAgent,created_at AS createdAt,last_used_at AS lastUsedAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY last_used_at DESC').all(userId, now()); }
export function revokeListedSession(userId, hashedId) { return db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL').run(now(), userId, hashedId).changes > 0; }
export function purgeSessions() {
  const timestamp = now();
  const sessions = db.prepare('DELETE FROM sessions WHERE expires_at<=? OR revoked_at IS NOT NULL').run(timestamp).changes;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const attempts = db.prepare('DELETE FROM auth_attempts WHERE window_started_at<? AND locked_until<?').run(cutoff, Date.now()).changes;
  const limits = db.prepare('DELETE FROM request_limits WHERE window_started_at<?').run(cutoff).changes;
  const actionTokens = db.prepare('DELETE FROM account_action_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(timestamp).changes;
  const challenges = db.prepare('DELETE FROM mfa_challenges WHERE expires_at<=? OR used_at IS NOT NULL').run(timestamp).changes;
  return { sessions, attempts, limits, actionTokens, challenges };
}
purgeSessions();
const sessionPurgeTimer = setInterval(() => { try { purgeSessions(); } catch { /* maintenance retries on the next interval */ } }, 60 * 60 * 1000);
sessionPurgeTimer.unref();
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
export function clearAuthFailuresForAccount(email) {
  const account = createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
  db.prepare('DELETE FROM request_limits WHERE bucket LIKE ?').run(`pair:${account}:%`);
  return db.prepare("DELETE FROM auth_attempts WHERE bucket LIKE ?").run(`pair:${account}:%`).changes;
}
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
export function createReviewNotifications(workspaceId, userIds, reviewId, title, body) {
  const insert=db.prepare('INSERT INTO notifications(id,workspace_id,user_id,review_id,title,body,created_at) VALUES(?,?,?,?,?,?,?)');
  const at=now();
  transaction(()=>{ for(const userId of new Set(userIds)) insert.run(randomUUID(),workspaceId,userId,reviewId,String(title).slice(0,160),String(body).slice(0,500),at); });
}
export function getNotifications(workspaceId,userId) {
  return db.prepare('SELECT id,review_id AS reviewId,title,body,created_at AS createdAt,read_at AS readAt FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').all(workspaceId,userId);
}
export function markNotificationRead(workspaceId,userId,id) {
  return db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE workspace_id=? AND user_id=? AND id=?').run(now(),workspaceId,userId,id).changes>0;
}
export function getWorkspaceMemberByEmail(workspaceId, email) {
  return db.prepare(`SELECT u.id AS userId,u.email,m.role FROM memberships m
    JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?`)
    .get(workspaceId, String(email || '').trim().toLowerCase()) || null;
}
export function changeMemberRole(workspaceId, userId, role) {
  return transaction(() => {
    const result = db.prepare("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=? AND role!='owner'").run(role, workspaceId, userId);
    if (result.changes) db.prepare('UPDATE sessions SET revoked_at=? WHERE workspace_id=? AND user_id=? AND revoked_at IS NULL').run(now(), workspaceId, userId);
    return result.changes ? getMembership(workspaceId, userId) : null;
  });
}
export function removeMember(workspaceId, userId) {
  return transaction(() => {
    const removed = db.prepare("DELETE FROM memberships WHERE workspace_id=? AND user_id=? AND role!='owner'").run(workspaceId, userId).changes > 0;
    if (removed) db.prepare('UPDATE sessions SET revoked_at=? WHERE workspace_id=? AND user_id=? AND revoked_at IS NULL').run(now(), workspaceId, userId);
    return removed;
  });
}
export function recordAuditEvent({ workspaceId = null, actorId = null, action, targetType, targetId = null, occurredAt = now(), requestOrigin = null, details = {} }) {
  const id=randomUUID(), canonicalRow={id,workspace_id:workspaceId,actor_id:actorId,action,target_type:targetType,target_id:targetId,occurred_at:occurredAt,request_origin:requestOrigin,details:JSON.stringify(details)};
  const previousHash=db.prepare('SELECT event_hash FROM audit_events WHERE workspace_id IS ? ORDER BY rowid DESC LIMIT 1').get(workspaceId)?.event_hash || '';
  const eventHash=auditHash(previousHash,canonicalRow);
  db.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,action,target_type,target_id,occurred_at,request_origin,details,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,workspaceId,actorId,action,targetType,targetId,occurredAt,requestOrigin,canonicalRow.details,previousHash,eventHash);
}
export function verifyAuditChain(workspaceId) {
  const rows=db.prepare('SELECT rowid AS sequence,* FROM audit_events WHERE workspace_id=? ORDER BY rowid').all(workspaceId);
  let previousHash='';
  for (let index=0;index<rows.length;index+=1) {
    const row=rows[index];
    if (row.previous_hash!==previousHash) return {intact:false,checkedEvents:index,firstBreak:{eventId:row.id,sequence:row.sequence,reason:'previous_hash_mismatch'}};
    const expectedHash=auditHash(previousHash,row);
    if (row.event_hash!==expectedHash) return {intact:false,checkedEvents:index,firstBreak:{eventId:row.id,sequence:row.sequence,reason:'event_hash_mismatch'}};
    previousHash=row.event_hash;
  }
  return {intact:true,checkedEvents:rows.length,firstBreak:null};
}
export function verifyAllAuditChains() {
  return db.prepare('SELECT DISTINCT workspace_id AS workspaceId FROM audit_events WHERE workspace_id IS NOT NULL ORDER BY workspace_id').all()
    .map(({workspaceId})=>({workspaceId,...verifyAuditChain(workspaceId)}));
}
export function rollbackAuditChain() {
  const columns=new Set(db.prepare('PRAGMA table_info(audit_events)').all().map((column)=>column.name));
  db.exec('BEGIN IMMEDIATE; DROP TRIGGER IF EXISTS audit_events_no_update; DROP TRIGGER IF EXISTS audit_events_no_delete;');
  try {
    if (columns.has('event_hash')) db.exec('ALTER TABLE audit_events DROP COLUMN event_hash');
    if (columns.has('previous_hash')) db.exec('ALTER TABLE audit_events DROP COLUMN previous_hash');
    db.exec(`CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events is append-only'); END;
      CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events is append-only'); END; COMMIT;`);
  } catch(error) { db.exec('ROLLBACK');throw error; }
}
export function listAuditEvents(workspaceId, { limit = 500, before = null } = {}) {
  const cap=Math.max(1,Math.min(1000,Number(limit)||500));
  return db.prepare(`SELECT e.id,e.workspace_id AS workspaceId,e.actor_id AS actorId,u.email AS actorEmail,e.action,e.target_type AS targetType,e.target_id AS targetId,e.occurred_at AS occurredAt,e.request_origin AS requestOrigin,e.details
    FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.workspace_id=? AND (? IS NULL OR e.occurred_at<?) ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`).all(workspaceId,before,before,cap).map((row)=>({...row,details:JSON.parse(row.details)}));
}
export function reviewHistory(workspaceId, reviewId) {
  if (!db.prepare('SELECT 1 FROM reviews WHERE workspace_id=? AND id=?').get(workspaceId,reviewId)) return null;
  const revisions=db.prepare('SELECT v.id,v.revision,v.content_hash AS contentHash,v.created_at AS createdAt,u.email AS editor FROM review_revisions v JOIN users u ON u.id=v.editor_id WHERE v.workspace_id=? AND v.review_id=? ORDER BY v.revision').all(workspaceId,reviewId);
  const events=listAuditEvents(workspaceId,{limit:1000}).filter((event)=>event.targetType==='review'&&event.targetId===reviewId);
  const decisions=db.prepare('SELECT d.decision,d.revision_id AS revisionId,v.revision,d.created_at AS createdAt,d.actor_id AS actorId,u.email AS actor FROM decisions d JOIN users u ON u.id=d.actor_id JOIN review_revisions v ON v.id=d.revision_id WHERE d.workspace_id=? AND d.review_id=? ORDER BY d.created_at').all(workspaceId,reviewId);
  return { events, revisions, decisions };
}
const reviewSelect = `SELECT r.*,v.content,v.revision,v.content_hash AS contentHash FROM reviews r LEFT JOIN review_revisions v ON v.id=r.current_revision_id`;
function shapeReview(row) {
  if (!row) return null;
  const claimResults = db.prepare('SELECT c.claim_text AS claim,c.verdict,c.source_id AS sourceId,c.source_version AS sourceVersion,c.source_name AS sourceName,c.evidence,c.explanation,c.mode,c.model_name AS modelName,c.prompt_version AS promptVersion,c.passage_id AS passageId,c.job_id AS jobId FROM claims c WHERE c.review_id=? AND c.revision_id=? ORDER BY c.rowid').all(row.id,row.current_revision_id);
  const { id,workspace_id:workspaceId,title,content,file_id:fileId,file_name:fileName,owner_email:owner,owner_id:ownerId,team,status,created_at:date,updated_at:updatedAt,findings_count:findings,verified_at:verifiedAt,revision,contentHash,current_revision_id:currentRevisionId } = row;
  return { id,workspaceId,title,content:content || '',fileId,fileName,owner,ownerId,team,status,date,updatedAt,findings,verifiedAt,revision:revision || 1,currentRevisionId,contentHash,claimResults };
}
export function saveReview(workspaceId, record, actorId = record.ownerId, requestOrigin = null, { recordDecision = true } = {}) {
  const previous = getReview(workspaceId,record.id);
  const actor = actorId && db.prepare('SELECT 1 FROM users WHERE id=?').get(actorId) ? actorId : record.ownerId || db.prepare("SELECT user_id FROM memberships WHERE workspace_id=? ORDER BY role='owner' DESC LIMIT 1").get(workspaceId)?.user_id;
  if (!actor) throw new Error('Review actor is required.');
  const at=now(), content=String(record.content || ''), changed=!previous || previous.content !== content;
  const currentRevision = db.prepare('SELECT revision,locked FROM review_revisions WHERE id=(SELECT current_revision_id FROM reviews WHERE workspace_id=? AND id=?)').get(workspaceId,record.id);
  const revisionNumber=changed ? (currentRevision?.revision || 0)+1 : (currentRevision?.revision || 1);
  const revisionId=changed ? randomUUID() : db.prepare('SELECT current_revision_id FROM reviews WHERE workspace_id=? AND id=?').get(workspaceId,record.id)?.current_revision_id;
  const hash=createHash('sha256').update(content).digest('hex');
  const status=(changed&&previous&&['Approved','Rejected'].includes(previous.status)&&record.status===previous.status)?'In review':(record.status||previous?.status||'In review');
  transaction(()=>{
    db.prepare(`INSERT INTO reviews(id,workspace_id,title,owner_id,owner_email,team,status,created_at,updated_at,current_revision_id,file_id,file_name,findings_count,verified_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,team=excluded.team,status=excluded.status,updated_at=excluded.updated_at,current_revision_id=excluded.current_revision_id,file_id=excluded.file_id,file_name=excluded.file_name,findings_count=excluded.findings_count,verified_at=excluded.verified_at`)
      .run(record.id,workspaceId,record.title || previous?.title || '(untitled)',record.ownerId || previous?.ownerId || actor,record.owner || previous?.owner || '',record.team || previous?.team || 'Unassigned',status,previous?.date || record.date || at,at,revisionId,record.fileId || previous?.fileId || null,record.fileName || previous?.fileName || null,Number(record.findings || 0),record.verifiedAt || null);
    if (changed) {
      db.prepare('INSERT INTO review_revisions(id,workspace_id,review_id,revision,content,content_hash,editor_id,created_at,locked) VALUES(?,?,?,?,?,?,?,?,0)').run(revisionId,workspaceId,record.id,revisionNumber,content,hash,actor,at);
      const action=previous?'review.revised':'review.submitted';
      recordAuditEvent({workspaceId,actorId:actor,action,targetType:'review',targetId:record.id,occurredAt:at,requestOrigin,details:{revision:revisionNumber,contentHash:hash}});
    }
    const oldStatus=previous?.status;
    if (recordDecision && status && status!==oldStatus && ['Approved','Rejected','Needs changes'].includes(status)) {
      if (record.ownerId===actor) throw Object.assign(new Error('Review authors cannot make decisions on their own submission.'),{status:403});
      if (currentRevision) db.prepare('UPDATE review_revisions SET locked=1 WHERE id=?').run(previous ? db.prepare('SELECT current_revision_id FROM reviews WHERE id=?').get(record.id).current_revision_id : revisionId);
      db.prepare('INSERT INTO decisions(id,workspace_id,review_id,revision_id,actor_id,decision,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,record.id,revisionId,actor,status,at);
      recordAuditEvent({workspaceId,actorId:actor,action:`review.${status.toLowerCase().replaceAll(' ','_')}`,targetType:'review',targetId:record.id,occurredAt:at,requestOrigin,details:{revision:revisionNumber}});
    } else if (status && status!==oldStatus) {
      recordAuditEvent({workspaceId,actorId:actor,action:'review.status_changed',targetType:'review',targetId:record.id,occurredAt:at,requestOrigin,details:{from:oldStatus,to:status}});
    }
    db.prepare('DELETE FROM claims WHERE review_id=? AND revision_id=?').run(record.id,revisionId);
    for (const item of record.claimResults || []) {
      const claimId=randomUUID();
      db.prepare('INSERT INTO claims(id,workspace_id,review_id,revision_id,claim_text,verdict,source_id,source_version,source_name,evidence,explanation,created_at,mode,model_name,prompt_version,passage_id,job_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(claimId,workspaceId,record.id,revisionId,String(item.claim || ''),item.verdict || 'Not enough evidence',item.sourceId || null,item.sourceVersion || null,item.sourceName || null,item.evidence || null,item.explanation || '',at,item.mode||null,item.modelName||null,item.promptVersion||null,item.passageId||null,item.jobId||null);
      if (item.verdict!=='Supported') db.prepare('INSERT INTO findings(id,workspace_id,review_id,revision_id,claim_id,source_id,source_version,created_at,mode,model_name,prompt_version,passage_id,job_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,record.id,revisionId,claimId,item.sourceId||null,item.sourceVersion||null,at,item.mode||null,item.modelName||null,item.promptVersion||null,item.passageId||null,item.jobId||null);
    }
  });
}
export function getReviews(workspaceId) { return db.prepare(`${reviewSelect} WHERE r.workspace_id=? ORDER BY r.created_at DESC`).all(workspaceId).map(shapeReview); }
export function getReview(workspaceId, id) { return shapeReview(db.prepare(`${reviewSelect} WHERE r.workspace_id=? AND r.id=?`).get(workspaceId,id)); }
export function saveSource(workspaceId, record) {
  const ownerId=record.ownerId || record.uploaderId || db.prepare("SELECT user_id FROM memberships WHERE workspace_id=? ORDER BY role='owner' DESC LIMIT 1").get(workspaceId)?.user_id;
  if (!ownerId) throw new Error('Source owner is required.');
  const userEmail=(id)=>db.prepare('SELECT email FROM users WHERE id=?').get(id)?.email || '';
  db.prepare(`INSERT INTO sources(id,workspace_id,name,category,owner_id,owner_email,uploader_id,uploader_email,type,file_name,size,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,type=excluded.type,file_name=excluded.file_name,size=excluded.size,updated_at=excluded.updated_at`)
    .run(record.id,workspaceId,record.name || '',record.category || 'General',ownerId,userEmail(ownerId),record.uploaderId || ownerId,userEmail(record.uploaderId || ownerId),record.type || '',record.fileName || '',Number(record.size || 0),record.updated || record.uploadedAt || now());
}
function shapeSource(row) { if(!row)return null; return {id:row.id,workspaceId:row.workspace_id,name:row.name,category:row.category,ownerId:row.owner_id,owner:row.owner_email,uploaderId:row.uploader_id,uploader:row.uploader_email,type:row.type,fileName:row.file_name,size:row.size,updated:row.updated_at}; }
export function getSource(workspaceId, sourceId) { return shapeSource(db.prepare('SELECT * FROM sources WHERE workspace_id=? AND id=?').get(workspaceId,sourceId)); }
export function getSources(workspaceId) {
  return db.prepare('SELECT s.*,v.version,v.file_id AS fileId,v.checksum,v.uploaded_at AS uploadedAt,v.expires_at AS expiresAt,COALESCE(f.scan_status,v.scan_status) AS scanStatus FROM sources s LEFT JOIN source_versions v ON v.source_id=s.id AND v.version=(SELECT MAX(v2.version) FROM source_versions v2 WHERE v2.source_id=s.id) LEFT JOIN stored_files f ON f.id=v.file_id WHERE s.workspace_id=? ORDER BY s.updated_at DESC').all(workspaceId).map((row) => {
    const record = shapeSource(row);
    // Keep the legacy response field while ensuring uploaded source bytes are available only through authorized file links.
    return { ...record, text: '', ...(row.version ? { version: row.version, fileId: row.fileId, checksum: row.checksum, uploadedAt: row.uploadedAt, expiresAt: row.expiresAt, scanStatus: row.scanStatus || 'quarantined' } : { scanStatus: 'quarantined' }) };
  });
}
export function getSourceVersionRows(workspaceId, sourceId) {
  return db.prepare('SELECT v.source_id AS sourceId,v.version,v.file_id AS fileId,v.owner_id AS ownerId,owner.email AS owner,v.uploader_id AS uploaderId,uploader.email AS uploader,v.checksum,v.uploaded_at AS uploadedAt,v.expires_at AS expiresAt,f.original_name AS fileName,f.content_type AS contentType,f.size,COALESCE(f.scan_status,v.scan_status) AS scanStatus FROM source_versions v JOIN users owner ON owner.id=v.owner_id JOIN users uploader ON uploader.id=v.uploader_id LEFT JOIN stored_files f ON f.id=v.file_id WHERE v.workspace_id=? AND v.source_id=? ORDER BY v.version DESC').all(workspaceId, sourceId);
}
export function saveSourceVersion(workspaceId, source, version) {
  transaction(() => {
    saveSource(workspaceId,source);
    db.prepare('INSERT INTO source_versions(source_id,workspace_id,version,file_id,owner_id,uploader_id,checksum,uploaded_at,expires_at,scan_status) VALUES(?,?,?,?,?,?,?,?,?,?)').run(source.id, workspaceId, version.version, version.fileId, version.ownerId, version.uploaderId, version.checksum, version.uploadedAt, version.expiresAt || null, version.scanStatus || 'quarantined');
    const passages=String(version.text||'').split(/\n{2,}/).flatMap((paragraph)=>paragraph.match(/[^.!?\n]+[.!?]+["')\]]*|[^.!?\n]+$/g)||[]).map((text)=>text.trim()).filter(Boolean);
    const insertPassage=db.prepare('INSERT INTO source_passages(id,workspace_id,source_id,version,passage_number,text,content_hash) VALUES(?,?,?,?,?,?,?)');
    passages.forEach((text,index)=>insertPassage.run(randomUUID(),workspaceId,source.id,version.version,index+1,text,createHash('sha256').update(text).digest('hex')));
    recordAuditEvent({workspaceId,actorId:version.uploaderId,action:version.version>1?'source.new_version':'source.upload',targetType:'source',targetId:source.id,occurredAt:version.uploadedAt,requestOrigin:version.requestOrigin||null,details:{version:version.version,checksum:version.checksum}});
  });
}
export function getCurrentSourceFile(workspaceId, sourceId) {
  const row=db.prepare('SELECT s.*,v.version,v.file_id AS fileId,v.owner_id AS ownerId,v.uploader_id AS uploaderId,v.checksum,v.uploaded_at AS uploadedAt,v.expires_at AS expiresAt,COALESCE(f.scan_status,v.scan_status) AS scanStatus,f.storage_key AS storageKey,f.original_name AS fileName,f.content_type AS contentType,f.size,f.purpose,f.id,f.workspace_id AS workspaceId,f.deleted_at AS deletedAt FROM sources s JOIN source_versions v ON v.source_id=s.id AND v.version=(SELECT MAX(v2.version) FROM source_versions v2 WHERE v2.source_id=s.id) LEFT JOIN stored_files f ON f.id=v.file_id WHERE s.workspace_id=? AND s.id=?').get(workspaceId,sourceId);
  return row ? {...shapeSource(row),...row} : null;
}
export function getSourceForFile(workspaceId, fileId) {
  const row = db.prepare('SELECT s.*,v.source_id AS sourceId,v.version FROM source_versions v JOIN sources s ON s.id=v.source_id WHERE v.workspace_id=? AND v.file_id=?').get(workspaceId,fileId);
  return row ? { ...shapeSource(row), id: row.sourceId, version: row.version } : null;
}
export function canAccessCollection(workspaceId, category, userId, role) {
  if (typeof category !== 'string' || !category.trim()) return false;
  const row = db.prepare('SELECT allowed_roles AS allowedRoles,allowed_user_ids AS allowedUserIds FROM collection_access WHERE workspace_id=? AND category=?').get(workspaceId,category);
  if (!row) return true;
  return JSON.parse(row.allowedRoles).includes(role) || JSON.parse(row.allowedUserIds).includes(userId);
}
export function getCollectionAccess(workspaceId, category) {
  const row = db.prepare('SELECT allowed_roles AS allowedRoles,allowed_user_ids AS allowedUserIds,updated_by AS updatedBy,updated_at AS updatedAt FROM collection_access WHERE workspace_id=? AND category=?').get(workspaceId,category);
  return row ? { category, allowedRoles: JSON.parse(row.allowedRoles), allowedUserIds: JSON.parse(row.allowedUserIds), updatedBy: row.updatedBy, updatedAt: row.updatedAt } : { category, allowedRoles: null, allowedUserIds: null, updatedBy: null, updatedAt: null };
}
export function setCollectionAccess(workspaceId, category, roles, userIds, actorId) {
  const updatedAt = now();
  db.prepare('INSERT INTO collection_access(workspace_id,category,allowed_roles,allowed_user_ids,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,category) DO UPDATE SET allowed_roles=excluded.allowed_roles,allowed_user_ids=excluded.allowed_user_ids,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(workspaceId,category,JSON.stringify(roles),JSON.stringify(userIds),actorId,updatedAt);
  return { category, allowedRoles: roles, allowedUserIds: userIds, updatedAt };
}
export function collectionMembersExist(workspaceId, userIds) {
  if (!userIds.length) return true;
  const placeholders = userIds.map(() => '?').join(',');
  const count = db.prepare(`SELECT COUNT(*) AS count FROM memberships WHERE workspace_id=? AND user_id IN (${placeholders})`).get(workspaceId,...userIds).count;
  return count === userIds.length;
}
export function insertStoredFile(file) {
  db.prepare('INSERT INTO stored_files(id,workspace_id,owner_id,uploader_id,purpose,resource_id,original_name,content_type,size,checksum,storage_key,scan_status,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(file.id,file.workspaceId,file.ownerId,file.uploaderId,file.purpose,file.resourceId,file.originalName,file.contentType,file.size,file.checksum,file.storageKey,'quarantined',file.uploadedAt);
  recordFileAction({ workspaceId: file.workspaceId, fileId: file.id, actorId: file.uploaderId, action: file.action || 'upload', details: { purpose: file.purpose, checksum: file.checksum, size: file.size }, requestOrigin:file.requestOrigin });
}
export function getStoredFile(workspaceId, fileId) { return db.prepare('SELECT id,workspace_id AS workspaceId,owner_id AS ownerId,uploader_id AS uploaderId,purpose,resource_id AS resourceId,original_name AS originalName,content_type AS contentType,size,checksum,storage_key AS storageKey,scan_status AS scanStatus,scan_engine AS scanEngine,uploaded_at AS uploadedAt,deleted_at AS deletedAt FROM stored_files WHERE workspace_id=? AND id=?').get(workspaceId,fileId) || null; }
export function getStoredFileById(fileId) { return db.prepare('SELECT id,workspace_id AS workspaceId,owner_id AS ownerId,uploader_id AS uploaderId,purpose,resource_id AS resourceId,original_name AS originalName,content_type AS contentType,size,checksum,storage_key AS storageKey,scan_status AS scanStatus,scan_engine AS scanEngine,uploaded_at AS uploadedAt,deleted_at AS deletedAt FROM stored_files WHERE id=?').get(fileId) || null; }
export function updateStoredFileScan(workspaceId, fileId, actorId, status, engine, detail = '', requestOrigin = null) {
  const changed = db.prepare('UPDATE stored_files SET scan_status=?,scan_engine=? WHERE workspace_id=? AND id=? AND deleted_at IS NULL').run(status,engine,workspaceId,fileId).changes > 0;
  if (changed) recordFileAction({ workspaceId, fileId, actorId, action: 'scan_result', details: { status, engine, detail: String(detail).slice(0,500) },requestOrigin });
  return changed;
}
export function recordFileAction({ workspaceId, fileId, actorId, action, details = {}, requestOrigin = null }) { recordAuditEvent({workspaceId,actorId,action:`file.${action}`,targetType:'file',targetId:fileId,requestOrigin,details}); }
export function listFileActionEvents(workspaceId, fileId) { return listAuditEvents(workspaceId,{limit:1000}).filter((event)=>event.targetType==='file'&&event.targetId===fileId).map((event)=>({...event,action:event.action.startsWith('file.')?event.action.slice(5):event.action})); }
export function markStoredFileDeleted(workspaceId, fileId, actorId, requestOrigin = null) {
  const changed = db.prepare('UPDATE stored_files SET deleted_at=? WHERE workspace_id=? AND id=? AND deleted_at IS NULL').run(now(),workspaceId,fileId).changes > 0;
  if (changed) recordFileAction({ workspaceId,fileId,actorId,action:'delete',requestOrigin });
  return changed;
}
export function getSourcesForVerification(workspaceId) {
  return db.prepare('SELECT s.*,v.source_id AS sourceId,v.version,v.file_id AS fileId,v.checksum,v.expires_at AS expiresAt,COALESCE(f.storage_key,NULL) AS storageKey,COALESCE(f.scan_status,v.scan_status) AS scanStatus,f.deleted_at AS deletedAt FROM sources s JOIN source_versions v ON v.source_id=s.id AND v.version=(SELECT MAX(v2.version) FROM source_versions v2 WHERE v2.source_id=s.id) LEFT JOIN stored_files f ON f.id=v.file_id WHERE s.workspace_id=?').all(workspaceId).map((row)=>({...shapeSource(row),sourceId:row.sourceId,version:row.version,fileId:row.fileId,checksum:row.checksum,expiresAt:row.expiresAt,storageKey:row.storageKey,scanStatus:row.scanStatus,deletedAt:row.deletedAt}));
}
export function markLegacySourceClean(workspaceId, sourceId, version, actorId, engine) {
  const updated=db.prepare("UPDATE source_versions SET scan_status='clean' WHERE workspace_id=? AND source_id=? AND version=? AND file_id IS NULL AND scan_status='quarantined'").run(workspaceId,sourceId,version).changes>0;
  if(updated) recordAuditEvent({workspaceId,actorId,action:'source.legacy_rescan_clean',targetType:'source',targetId:sourceId,details:{version,engine}});
  return updated;
}
export function markLegacySourceRejected(workspaceId,sourceId,version,actorId,engine,detail=''){
  const updated=db.prepare("UPDATE source_versions SET scan_status='rejected' WHERE workspace_id=? AND source_id=? AND version=? AND file_id IS NULL AND scan_status='quarantined'").run(workspaceId,sourceId,version).changes>0;
  if(updated)recordAuditEvent({workspaceId,actorId,action:'source.legacy_rescan_rejected',targetType:'source',targetId:sourceId,details:{version,engine,detail:String(detail).slice(0,500)}});
  return updated;
}
export function getCleanLegacySourceText(workspaceId,sourceId,version){
  const status=db.prepare("SELECT scan_status FROM source_versions WHERE workspace_id=? AND source_id=? AND version=? AND file_id IS NULL").get(workspaceId,sourceId,version);
  if(status?.scan_status!=='clean')return null;
  return db.prepare('SELECT group_concat(text,char(10)||char(10)) AS text FROM source_passages WHERE workspace_id=? AND source_id=? AND version=?').get(workspaceId,sourceId,version)?.text||null;
}
export function legacySourcesForRescan(workspaceId = null) {
  return db.prepare(`SELECT s.id,s.workspace_id AS workspaceId,s.name,s.category,s.type,v.version,v.checksum,v.owner_id AS ownerId,v.uploader_id AS uploaderId,v.uploaded_at AS uploadedAt,v.expires_at AS expiresAt,p.text
    FROM sources s JOIN source_versions v ON v.source_id=s.id LEFT JOIN source_passages p ON p.source_id=v.source_id AND p.version=v.version
    WHERE v.file_id IS NULL AND v.scan_status='quarantined' AND (? IS NULL OR s.workspace_id=?) ORDER BY s.workspace_id,s.id,v.version,p.passage_number`).all(workspaceId,workspaceId);
}
export function closeStore() { clearInterval(sessionPurgeTimer); db.close(); }
