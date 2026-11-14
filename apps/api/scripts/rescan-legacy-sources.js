import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootEnv=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.env');
try{for(const line of (await readFile(rootEnv,'utf8')).split(/\r?\n/)){const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(match&&process.env[match[1]]===undefined)process.env[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');}}catch{/* Host environment variables may be supplied by the deployment. */}
const [{validateTextUpload},{scanUpload},store]=await Promise.all([
  import('../src/services/file-validation.js'),import('../src/services/file-scanner.js'),import('../src/services/store.js'),
]);
const {getStoredFile,legacySourcesForRescan,markLegacySourceClean,markLegacySourceRejected,updateStoredFileScan,closeStore}=store;

const workspaceId=process.argv[2]||null;
const rows=legacySourcesForRescan(workspaceId);
const versions=new Map();
for(const row of rows){const key=`${row.workspaceId}:${row.id}:${row.version}`;const item=versions.get(key)||{...row,passages:[]};if(row.text)item.passages.push(row.text);versions.set(key,item);}
let clean=0,rejected=0,failed=0;
try{
  for(const source of versions.values()){
    const bytes=Buffer.from(source.passages.join('\n\n'),'utf8');
    try{
      const extension={TXT:'.txt',MD:'.md',CSV:'.csv'}[String(source.type||'TXT').toUpperCase().replace(/^\./,'')]||'.txt';
      validateTextUpload(bytes,extension);
      const result=await scanUpload(bytes);
      if(result.status==='clean'){
        if(source.fileId){const file=getStoredFile(source.workspaceId,source.fileId);if(file)updateStoredFileScan(source.workspaceId,file.id,source.uploaderId,'clean',result.engine);}
        else markLegacySourceClean(source.workspaceId,source.id,source.version,source.uploaderId,result.engine);
        clean++;
      }else if(source.fileId){const file=getStoredFile(source.workspaceId,source.fileId);if(file)updateStoredFileScan(source.workspaceId,file.id,source.uploaderId,'rejected',result.engine,result.detail||'');rejected++;}
      else {markLegacySourceRejected(source.workspaceId,source.id,source.version,source.uploaderId,result.engine,result.detail||'');rejected++;}
    }catch(error){failed++;console.error(`[legacy source] ${source.id} v${source.version} remains quarantined: ${error.message}`);}
  }
  console.log(`Legacy source rescan complete: ${versions.size} checked, ${clean} clean, ${rejected} rejected, ${failed} left quarantined.`);
  if(failed)process.exitCode=1;
}finally{closeStore();}
