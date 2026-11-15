import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootEnv=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..','.env');
export function applyEnvText(content,target=process.env) {
  for(const line of content.split(/\r?\n/)) {
    const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(match&&target[match[1]]===undefined)target[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');
  }
  return target;
}
try {
  const content=await readFile(rootEnv,'utf8');
  applyEnvText(content);
} catch { /* The host may provide all configuration directly. */ }
