import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here=path.dirname(fileURLToPath(import.meta.url));
const dbPath=path.resolve(process.env.CLEARED_DB_PATH||path.join(here,'../data/cleared.sqlite'));
const direction=process.argv[2]||'up';
if(direction==='up'){
  process.env.CLEARED_DB_PATH=dbPath;
  await import(pathToFileURL(path.join(here,'../src/services/store.js')).href);
  console.log('Phase 3 migration is applied (or was already applied).');
} else if(direction==='down'){
  const db=new DatabaseSync(dbPath); const backupPath=`${dbPath}.rollback-${new Date().toISOString().replace(/[:.]/g,'-')}.bak.sqlite`;
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'","''")}'`); console.log(`Rollback snapshot created at ${backupPath}`);
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_events'").get()){db.close();console.log('Phase 3 migration is not applied.');process.exit(0);}
  const reviews=db.prepare(`SELECT r.*,v.content FROM reviews r LEFT JOIN review_revisions v ON v.id=r.current_revision_id`).all().map((row)=>{
    const claimResults=db.prepare('SELECT claim_text AS claim,verdict,source_id AS sourceId,source_version AS sourceVersion,source_name AS sourceName,evidence,explanation FROM claims WHERE review_id=? AND revision_id=?').all(row.id,row.current_revision_id);
    return {id:row.id,title:row.title,content:row.content||'',owner:row.owner_email,ownerId:row.owner_id,team:row.team,status:row.status,date:row.created_at,updatedAt:row.updated_at,fileId:row.file_id,fileName:row.file_name,findings:row.findings_count,verifiedAt:row.verified_at,claimResults};
  });
  const sources=db.prepare(`SELECT s.*,v.version,v.file_id AS fileId,v.checksum,v.uploaded_at AS uploadedAt,v.expires_at AS expiresAt FROM sources s LEFT JOIN source_versions v ON v.source_id=s.id AND v.version=(SELECT MAX(v2.version) FROM source_versions v2 WHERE v2.source_id=s.id)`).all().map((row)=>({
    id:row.id,name:row.name,category:row.category,owner:row.owner_email,ownerId:row.owner_id,uploader:row.uploader_email,uploaderId:row.uploader_id,type:row.type,fileName:row.file_name,size:row.size,updated:row.updated_at,version:row.version,fileId:row.fileId,checksum:row.checksum,uploadedAt:row.uploadedAt,expiresAt:row.expiresAt,text:db.prepare('SELECT group_concat(text,char(10)||char(10)) AS text FROM source_passages WHERE source_id=? AND version=?').get(row.id,row.version)?.text||''
  }));
  const fileEvents=db.prepare("SELECT * FROM audit_events WHERE target_type='file' AND action LIKE 'file.%'").all();
  db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
    DROP TRIGGER IF EXISTS audit_events_no_update; DROP TRIGGER IF EXISTS audit_events_no_delete;
    DROP INDEX IF EXISTS reviews_workspace; DROP INDEX IF EXISTS review_revisions_workspace; DROP INDEX IF EXISTS claims_workspace; DROP INDEX IF EXISTS findings_workspace; DROP INDEX IF EXISTS decisions_workspace; DROP INDEX IF EXISTS sources_workspace; DROP INDEX IF EXISTS source_versions_file; DROP INDEX IF EXISTS source_passages_workspace; DROP INDEX IF EXISTS audit_events_workspace;
    ALTER TABLE reviews RENAME TO phase3_archive_reviews;
    ALTER TABLE review_revisions RENAME TO phase3_archive_review_revisions;
    ALTER TABLE claims RENAME TO phase3_archive_claims;
    ALTER TABLE findings RENAME TO phase3_archive_findings;
    ALTER TABLE decisions RENAME TO phase3_archive_decisions;
    ALTER TABLE sources RENAME TO phase3_archive_sources;
    ALTER TABLE source_versions RENAME TO phase3_archive_source_versions;
    ALTER TABLE source_passages RENAME TO phase3_archive_source_passages;
    ALTER TABLE audit_events RENAME TO phase3_archive_audit_events;
    DROP TABLE IF EXISTS reviews_legacy_phase3; DROP TABLE IF EXISTS sources_legacy_phase3; DROP TABLE IF EXISTS source_versions_legacy_phase3;
    CREATE TABLE reviews(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),data TEXT NOT NULL);
    CREATE TABLE sources(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),data TEXT NOT NULL);
    CREATE TABLE source_versions(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,version INTEGER NOT NULL,file_id TEXT REFERENCES stored_files(id),owner_id TEXT NOT NULL REFERENCES users(id),uploader_id TEXT NOT NULL REFERENCES users(id),checksum TEXT NOT NULL,uploaded_at TEXT NOT NULL,expires_at TEXT,PRIMARY KEY(source_id,version));
    CREATE TABLE file_action_events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),file_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX reviews_workspace ON reviews(workspace_id); CREATE INDEX sources_workspace ON sources(workspace_id); CREATE INDEX source_versions_file ON source_versions(file_id); CREATE INDEX file_action_events_workspace ON file_action_events(workspace_id,created_at);
  `);
  const insertReview=db.prepare('INSERT INTO reviews(id,workspace_id,data) VALUES(?,?,?)'); for(const row of reviews)insertReview.run(row.id,db.prepare('SELECT workspace_id FROM phase3_archive_reviews WHERE id=?').get(row.id).workspace_id,JSON.stringify(row));
  const insertSource=db.prepare('INSERT INTO sources(id,workspace_id,data) VALUES(?,?,?)');
  const insertVersion=db.prepare('INSERT INTO source_versions(source_id,workspace_id,version,file_id,owner_id,uploader_id,checksum,uploaded_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for(const source of sources){const ws=db.prepare('SELECT workspace_id FROM phase3_archive_sources WHERE id=?').get(source.id).workspace_id;insertSource.run(source.id,ws,JSON.stringify(source));for(const v of db.prepare('SELECT * FROM phase3_archive_source_versions WHERE source_id=?').all(source.id))insertVersion.run(v.source_id,v.workspace_id,v.version,v.file_id,v.owner_id,v.uploader_id,v.checksum,v.uploaded_at,v.expires_at);}
  const insertEvent=db.prepare('INSERT INTO file_action_events(id,workspace_id,file_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?,?,?)');for(const event of fileEvents)insertEvent.run(event.id,event.workspace_id,event.target_id,event.actor_id,event.action.slice(5),event.details,event.occurred_at);
  db.exec('COMMIT; PRAGMA foreign_keys=ON;');db.close();console.log('Phase 3 schema was rolled back. Current Phase 3 records remain archived in phase3_archive_* tables.');
} else { console.error('Use: node scripts/migrate-phase3.js [up|down]'); process.exitCode=2; }
