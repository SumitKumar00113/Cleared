import '../src/env.js';
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDatabase = path.resolve(here, '../data/cleared.sqlite');

export function backupSqlite(sourcePath, destinationPath) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination) throw new Error('Backup destination must differ from the database path.');
  if (!existsSync(source)) throw new Error(`SQLite database does not exist: ${source}`);
  if (existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  mkdirSync(path.dirname(destination), { recursive: true });

  const db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } catch (error) {
    if (existsSync(destination)) rmSync(destination);
    throw error;
  } finally {
    db.close();
  }

  try {
    chmodSync(destination, 0o600);
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      const result = check.prepare('PRAGMA integrity_check').get();
      if (result.integrity_check !== 'ok') throw new Error('SQLite backup failed integrity_check.');
    } finally {
      check.close();
    }
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  }
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) {
    console.error('Usage: node scripts/backup-sqlite.js <new-backup-path>');
    process.exitCode = 2;
  } else {
    try {
      const result = backupSqlite(process.env.CLEARED_DB_PATH || defaultDatabase, destination);
      console.log(`SQLite backup created and verified: ${result}`);
    } catch (error) {
      console.error(`SQLite backup failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
