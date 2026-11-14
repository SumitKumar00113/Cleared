import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../');
let dir,store,storage,account;
const uploadLimit=20*1024*1024;
before(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),'cleared-service-integration-'));
  process.env.CLEARED_DB_PATH=path.join(dir,'integration.sqlite');
  process.env.NODE_ENV='test';process.env.SESSION_SECRET='integration-session-secret-at-least-32-chars';
  process.env.MFA_ENCRYPTION_KEY='22'.repeat(32);process.env.FILE_STORAGE='s3';process.env.FILE_SCANNER='clamav';
  process.env.S3_ENDPOINT=process.env.S3_ENDPOINT||'http://127.0.0.1:9000';process.env.S3_BUCKET=process.env.S3_BUCKET||'cleared-private';
  process.env.S3_ACCESS_KEY_ID=process.env.S3_ACCESS_KEY_ID||'minioadmin';process.env.S3_SECRET_ACCESS_KEY=process.env.S3_SECRET_ACCESS_KEY||'minioadmin';
  process.env.CLAMAV_HOST=process.env.CLAMAV_HOST||'127.0.0.1';process.env.CLAMAV_PORT=process.env.CLAMAV_PORT||'3310';
  store=await import('../../src/services/store.js');
  const module=await import('../../src/services/file-storage.js');module.resetFileStorageForTests();storage=module.getFileStorage();
  account=await store.createWorkspaceAccount({workspaceName:'Integration Workspace',email:'service-integration@example.test',password:'ServiceIntegrationPassword!2026'});
});
after(async()=>{store?.closeStore();await rm(dir,{recursive:true,force:true});});

test('S3-compatible adapter round trips private objects on MinIO',async()=>{
  const key='72be234d-3e92-4d3a-b8b4-1b715aa6da57';const bytes=Buffer.from('private minio integration payload');
  await storage.put(key,bytes);assert.deepEqual(await storage.get(key),bytes);await storage.delete(key);
});

test('ClamAV accepts clean text and detects the standard EICAR test signature',async()=>{
  const {scanUpload}=await import('../../src/services/file-scanner.js');
  assert.equal((await scanUpload(Buffer.from('clean text for ClamAV'))).status,'clean');
  const eicar=Buffer.from(String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`);
  assert.equal((await scanUpload(eicar)).status,'rejected');
});

test('an unreachable scanner leaves a stored upload quarantined',async()=>{
  const originalHost=process.env.CLAMAV_HOST,originalPort=process.env.CLAMAV_PORT;
  process.env.CLAMAV_HOST='127.0.0.1';process.env.CLAMAV_PORT='1';
  try{
    const {storeTextUpload,deleteStoredObject}=await import('../../src/services/private-files.js');
    const uploaded=await storeTextUpload({upload:{originalname:'fail-closed.txt',buffer:Buffer.from('still quarantined'),size:17},request:{user:{workspaceId:account.workspace.id,userId:account.user.userId}},purpose:'source',resourceId:'scanner-offline-test',ownerId:account.user.userId});
    assert.equal(uploaded.record.scanStatus,'quarantined');await deleteStoredObject(uploaded.record);
  }finally{process.env.CLAMAV_HOST=originalHost;process.env.CLAMAV_PORT=originalPort;}
});

test('ClamAV file and stream limits meet the application upload limit',async()=>{
  const config=await readFile(path.join(root,'infra/clamd.integration.conf'),'utf8');
  const toBytes=(value)=>{const match=value.match(/^(\d+)([KMG]?)$/i);assert.ok(match,`invalid clamd size ${value}`);const unit={K:1024,M:1024**2,G:1024**3}[match[2].toUpperCase()]||1;return Number(match[1])*unit;};
  for(const name of ['MaxFileSize','StreamMaxLength']){const value=config.match(new RegExp(`^${name}\\s+(\\S+)`,'m'))?.[1];assert.ok(value,`${name} is configured`);assert.ok(toBytes(value)>=uploadLimit,`${name} must not be below 20 MiB`);}
});
