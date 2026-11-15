import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootEnv=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..','.env');
try {
  const content=await readFile(rootEnv,'utf8');
  for(const line of content.split(/\r?\n/)) {
    const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(match&&process.env[match[1]]===undefined)process.env[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');
  }
} catch { /* The host may provide all configuration directly. */ }
