import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { canAccessCollection, collectionMembersExist, deleteSource, getCollectionAccess, getSource, getSourceVersionRows, getSources, getStoredFile, markStoredFileDeleted, saveSourceVersion, setCollectionAccess, recordAuditEvent } from './store.js';
import { requireRecentAuth, requireRole } from './auth.js';
import { storeTextUpload, deleteStoredObject } from './private-files.js';
import { rejectDisabledSourceUploads } from './upload-policy.js';

export const sourcesRouter = Router();
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const allowedExtensions = new Set(['.txt', '.md', '.csv']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1 }, fileFilter: (_request, file, callback) => {
  const extension = String(file.originalname || '').toLowerCase().match(/\.[^.\\/]+$/)?.[0] || '';
  if (!allowedExtensions.has(extension)) return callback(Object.assign(new Error('Use a TXT, MD, or CSV approved source.'), { status: 415 }));
  callback(null, true);
} });
const canManageSources = requireRole(['owner','administrator','brand_manager']);
function expiresAtFrom(body) {
  if (!body?.expiresAt) return null;
  const value = new Date(body.expiresAt);
  if (Number.isNaN(value.getTime())) throw Object.assign(new Error('Enter a valid source expiry date.'), { status: 400 });
  return value.toISOString();
}
function publicSource(source, file, text = '') {
  return { ...source, text, fileId: file.record.id, checksum: file.record.checksum, size: file.record.size, fileName: file.record.originalName, type: path.extname(file.record.originalName).slice(1).toUpperCase(), updated: file.record.uploadedAt, uploadedAt: file.record.uploadedAt, expiresAt: source.expiresAt || null, scanStatus: file.record.scanStatus };
}

sourcesRouter.get('/', (request, response) => {
  const now = Date.now();
  const data = getSources(request.user.workspaceId).filter((source) => canAccessCollection(request.user.workspaceId, source.category, request.user.userId, request.user.role)).map((source) => ({ ...source, expired: Boolean(source.expiresAt && new Date(source.expiresAt).getTime() <= now), expiringSoon: Boolean(source.expiresAt && new Date(source.expiresAt).getTime() > now && new Date(source.expiresAt).getTime() <= now + 30 * 86400000) }));
  return response.json({ data });
});

sourcesRouter.put('/collections/:category/access', requireRole(['owner','brand_manager']), requireRecentAuth, (request, response) => {
  const category = String(request.params.category || '').trim();
  const roles = request.body?.allowedRoles;
  const userIds = request.body?.allowedUserIds;
  const knownRoles = ['owner','administrator','brand_manager','reviewer','creator'];
  if (!category || category.length > 100 || !Array.isArray(roles) || !Array.isArray(userIds) || roles.some((role) => !knownRoles.includes(role)) || userIds.some((id) => typeof id !== 'string') || new Set(userIds).size !== userIds.length || !collectionMembersExist(request.user.workspaceId, userIds)) return response.status(400).json({ error: 'Choose valid collection roles and workspace members.' });
  const data=setCollectionAccess(request.user.workspaceId, category, [...new Set(roles)], userIds, request.user.userId);
  recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'collection.access_changed',targetType:'collection',targetId:category,requestOrigin:request.get('origin')||request.get('referer')||null,details:{allowedRoles:data.allowedRoles,allowedUserCount:data.allowedUserIds.length}});
  return response.json({ data });
});
sourcesRouter.get('/collections/:category/access', requireRole(['owner','brand_manager']), (request, response) => response.json({ data: getCollectionAccess(request.user.workspaceId, String(request.params.category || '').trim()) }));

sourcesRouter.get('/:id/versions', (request, response) => {
  const source = getSource(request.user.workspaceId, request.params.id);
  if (!source || !canAccessCollection(request.user.workspaceId, source.category, request.user.userId, request.user.role)) return response.status(404).json({ error: 'Source not found.' });
  return response.json({ data: getSourceVersionRows(request.user.workspaceId, request.params.id) });
});

sourcesRouter.post('/', rejectDisabledSourceUploads, canManageSources, upload.single('file'), async (request, response) => {
  const name = String(request.body?.name || '').trim();
  const category = String(request.body?.category || '').trim();
  if (!name || !category || !request.file) return response.status(400).json({ error: 'A source name, collection, and file are required.' });
  if (!canAccessCollection(request.user.workspaceId, category, request.user.userId, request.user.role)) return response.status(403).json({ error: 'Your account is not allowed to add files to this collection.' });
  let file;
  try {
    const expiresAt = expiresAtFrom(request.body);
    const id = randomUUID();
    const uploaded = await storeTextUpload({ upload: request.file, request, purpose: 'source', resourceId: id, ownerId: request.user.userId });
    file = uploaded;
    const version = { version: 1, fileId: uploaded.record.id, ownerId: request.user.userId, uploaderId: request.user.userId, checksum: uploaded.record.checksum, uploadedAt: uploaded.record.uploadedAt, expiresAt, text: uploaded.text, requestOrigin:request.get('origin')||request.get('referer')||null };
    const source = { id, workspaceId: request.user.workspaceId, version: 1, name, category, updated: version.uploadedAt, uploadedAt: version.uploadedAt, owner: request.user.email, ownerId: request.user.userId, uploader: request.user.email, uploaderId: request.user.userId, type: uploaded.record.contentType.split(';')[0].toUpperCase(), fileName: uploaded.record.originalName, size: uploaded.record.size, checksum: version.checksum, fileId: uploaded.record.id, expiresAt: version.expiresAt, scanStatus: uploaded.record.scanStatus };
    saveSourceVersion(request.user.workspaceId, source, version);
    const responseSource = publicSource(source, uploaded, '');
    return response.status(201).json({ data: responseSource });
  } catch (error) {
    if (file) await deleteStoredObject(file.record).catch(() => {});
    return response.status(error.status || 400).json({ error: error.message || 'Could not store this source.' });
  }
});

sourcesRouter.post('/:id/versions', rejectDisabledSourceUploads, canManageSources, upload.single('file'), async (request, response) => {
  const existing = getSource(request.user.workspaceId, request.params.id);
  if (!existing) return response.status(404).json({ error: 'Source not found.' });
  if (!canAccessCollection(request.user.workspaceId, existing.category, request.user.userId, request.user.role)) return response.status(404).json({ error: 'Source not found.' });
  if (!request.file) return response.status(400).json({ error: 'A source file is required.' });
  let file;
  try {
    const expiresAt = expiresAtFrom(request.body);
    const rows = getSourceVersionRows(request.user.workspaceId, existing.id);
    const versionNumber = Math.max(existing.version || 0, ...rows.map((item) => item.version)) + 1;
    const uploaded = await storeTextUpload({ upload: request.file, request, purpose: 'source', resourceId: existing.id, ownerId: existing.ownerId || request.user.userId, action: 'new_version' });
    file = uploaded;
    const version = { version: versionNumber, fileId: uploaded.record.id, ownerId: existing.ownerId || request.user.userId, uploaderId: request.user.userId, checksum: uploaded.record.checksum, uploadedAt: uploaded.record.uploadedAt, expiresAt, text: uploaded.text, requestOrigin:request.get('origin')||request.get('referer')||null };
    const source = { ...existing, version: versionNumber, updated: version.uploadedAt, uploadedAt: version.uploadedAt, uploader: request.user.email, uploaderId: request.user.userId, type: uploaded.record.contentType.split(';')[0].toUpperCase(), fileName: uploaded.record.originalName, size: uploaded.record.size, checksum: version.checksum, fileId: uploaded.record.id, expiresAt: version.expiresAt, scanStatus: uploaded.record.scanStatus };
    saveSourceVersion(request.user.workspaceId, source, version);
    return response.status(201).json({ data: publicSource(source, uploaded, '') });
  } catch (error) {
    if (file) await deleteStoredObject(file.record).catch(() => {});
    return response.status(error.status || 400).json({ error: error.message || 'Could not store this source version.' });
  }
});

sourcesRouter.delete('/:id', requireRole(['owner', 'administrator', 'brand_manager']), requireRecentAuth, async (request, response) => {
  const source = getSource(request.user.workspaceId, request.params.id);
  if (!source || !canAccessCollection(request.user.workspaceId, source.category, request.user.userId, request.user.role)) return response.status(404).json({ error: 'Source not found.' });
  try {
    for (const version of getSourceVersionRows(request.user.workspaceId, source.id)) {
      if (!version.fileId) continue;
      const file = getStoredFile(request.user.workspaceId, version.fileId);
      if (file && !file.deletedAt) {
        await deleteStoredObject(file);
        markStoredFileDeleted(request.user.workspaceId, file.id, request.user.userId,request.get('origin')||request.get('referer')||null);
      }
    }
    deleteSource(request.user.workspaceId, source.id, request.user.userId,request.get('origin')||request.get('referer')||null);
    return response.json({ deleted: true });
  } catch (error) { return response.status(500).json({ error: 'Could not delete this source.' }); }
});
