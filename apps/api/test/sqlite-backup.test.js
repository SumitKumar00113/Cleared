import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupSqlite } from '../scripts/backup-sqlite.js';

test('SQLite backup includes WAL data and restores with integrity intact', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cleared-sqlite-backup-'));
  const source = path.join(directory, 'source.sqlite');
  const backup = path.join(directory, 'backups', 'snapshot.sqlite');
  try {
    const original = new DatabaseSync(source);
    original.exec('PRAGMA journal_mode=WAL; CREATE TABLE marker(value TEXT NOT NULL); INSERT INTO marker VALUES (\'restorable\');');
    const result = backupSqlite(source, backup);
    assert.equal(result, backup);

    const restored = new DatabaseSync(backup);
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(restored.prepare('SELECT value FROM marker').get().value, 'restorable');
    restored.close();
    original.close();
    assert.throws(() => backupSqlite(source, backup), /already exists/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
