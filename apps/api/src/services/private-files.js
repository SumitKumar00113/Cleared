import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { getFileStorage } from './file-storage.js';
import { validateTextUpload } from './file-validation.js';
import { insertStoredFile, getStoredFile, updateStoredFileScan } from './store.js';
import { scanUpload } from './file-scanner.js';

export async function storeTextUpload({ upload, request, purpose, resourceId, ownerId, action = 'upload' }) {
  const extension = path.extname(String(upload.originalname || '')).toLowerCase();
  const { text, contentType } = validateTextUpload(upload.buffer, extension);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const checksum = createHash('sha256').update(upload.buffer).digest('hex');
  const storage = getFileStorage();
  const safeDisplayName = path.basename(String(upload.originalname || 'upload')).replace(/[\r\n\0]/g, '').slice(0, 240) || 'upload';
  await storage.put(id, upload.buffer);
  try {
    insertStoredFile({ id, workspaceId: request.user.workspaceId, ownerId, uploaderId: request.user.userId, purpose, resourceId, originalName: safeDisplayName, contentType, size: upload.size, checksum, storageKey: id, uploadedAt: timestamp, action, requestOrigin:request.get?.('origin')||request.get?.('referer')||null });
  } catch (error) {
    await storage.delete(id).catch(() => {});
    throw error;
  }
  try {
    const result = await scanUpload(upload.buffer);
    updateStoredFileScan(request.user.workspaceId, id, request.user.userId, result.status, result.engine, result.detail || '', request.get?.('origin')||request.get?.('referer')||null);
  } catch (error) {
    console.error(`[file scanner] Upload ${id} remains quarantined: ${error.message}`);
    updateStoredFileScan(request.user.workspaceId, id, request.user.userId, 'quarantined', 'unavailable', error.message, request.get?.('origin')||request.get?.('referer')||null);
  }
  const record = getStoredFile(request.user.workspaceId, id);
  return { record, text, storage };
}

export async function readCleanFile(file) {
  if (!file || file.scanStatus !== 'clean' || file.deletedAt) return null;
  return getFileStorage().get(file.storageKey);
}

export async function deleteStoredObject(file) {
  if (!file || file.deletedAt) return;
  await getFileStorage().delete(file.storageKey);
}
