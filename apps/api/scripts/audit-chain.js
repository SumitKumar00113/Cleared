import { existsSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const dbPath=path.resolve(process.env.CLEARED_DB_PATH||path.join(here,'../data/cleared.sqlite'));
const command=process.argv[2]||'verify';
const workspaceId=process.argv[3]||null;

function backupIfPresent() {
  if (!existsSync(dbPath)) return;
  const db=new DatabaseSync(dbPath);
  try {
    const backupPath=`${dbPath}.audit-chain-${new Date().toISOString().replace(/[:.]/g,'-')}.bak.sqlite`;
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'","''")}'`);
    console.info(`[migration] SQLite backup created at ${backupPath}`);
  } finally { db.close(); }
}

if (command==='up') {
  backupIfPresent();
  process.env.CLEARED_DB_PATH=dbPath;
  const store=await import(pathToFileURL(path.join(here,'../src/services/store.js')).href);
  console.log('Audit hash chain migration applied or already current.');
  store.closeStore();
} else if (command==='down') {
  backupIfPresent();
  process.env.CLEARED_DB_PATH=dbPath;
  process.env.CLEARED_SKIP_AUDIT_CHAIN_MIGRATION='1';
  const store=await import(pathToFileURL(path.join(here,'../src/services/store.js')).href);
  store.rollbackAuditChain();
  console.log('Audit hash chain columns removed; append-only audit events remain.');
  store.closeStore();
} else if (command==='verify') {
  process.env.CLEARED_DB_PATH=dbPath;
  const store=await import(pathToFileURL(path.join(here,'../src/services/store.js')).href);
  const results=workspaceId ? [{workspaceId,...store.verifyAuditChain(workspaceId)}] : store.verifyAllAuditChains();
  console.log(JSON.stringify(results,null,2));
  if (results.some((result)=>!result.intact)) process.exitCode=1;
  store.closeStore();
} else {
  console.error('Usage: node scripts/audit-chain.js <up|down|verify> [workspace-id]');
  process.exitCode=2;
}
