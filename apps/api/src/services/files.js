import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { getReview } from './store.js';
import { canAccessCollection, getStoredFile, getSourceForFile, updateStoredFileScan, recordFileAction } from './store.js';
import { getFileStorage } from './file-storage.js';
import { scanUpload } from './file-scanner.js';
import { requireRecentAuth, requireRole } from './auth.js';

export const filesRouter = Router();
const LINK_TTL_SECONDS = 120;
const secret = () => process.env.SESSION_SECRET || '';
const signature = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');
const equal = (left = '', right = '') => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
function makeToken({ fileId, workspaceId, userId, expiresAt }) {
  const payload = Buffer.from(JSON.stringify({ f: fileId, w: workspaceId, u: userId, e: expiresAt })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
function validToken(token, fileId, request) {
  const [payload, sig, extra] = String(token || '').split('.');
  if (!payload || !sig || extra || !equal(sig, signature(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.f === fileId && data.w === request.user.workspaceId && data.u === request.user.userId && Number.isInteger(data.e) && data.e >= Math.floor(Date.now() / 1000);
  } catch { return false; }
}
function mayOpen(file, request) {
  if (!file || file.deletedAt || file.scanStatus !== 'clean') return false;
  if (file.purpose === 'review') {
    const review = getReview(request.user.workspaceId, file.resourceId);
    return Boolean(review && (request.user.role !== 'creator' || review.ownerId === request.user.userId));
  }
  const source = file.purpose === 'source' && getSourceForFile(request.user.workspaceId, file.id);
  return Boolean(source && canAccessCollection(request.user.workspaceId, source.category, request.user.userId, request.user.role));
}

filesRouter.post('/:fileId/link', (request, response) => {
  const file = getStoredFile(request.user.workspaceId, request.params.fileId);
  if (!mayOpen(file, request)) return response.status(404).json({ error: 'File not found or unavailable.' });
  const expiresAt = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
  const token = makeToken({ fileId: file.id, workspaceId: request.user.workspaceId, userId: request.user.userId, expiresAt });
  recordFileAction({ workspaceId: request.user.workspaceId, fileId: file.id, actorId: request.user.userId, action: 'link_issued', details: { expiresAt: new Date(expiresAt * 1000).toISOString() }, requestOrigin: request.get('origin') || request.get('referer') || null });
  response.setHeader('Cache-Control', 'private, no-store');
  return response.json({ data: { url: `/api/files/${encodeURIComponent(file.id)}/download?token=${encodeURIComponent(token)}`, expiresAt: new Date(expiresAt * 1000).toISOString() } });
});

filesRouter.post('/:fileId/scan', requireRole(['owner','administrator','brand_manager']), requireRecentAuth, async (request, response) => {
  const file = getStoredFile(request.user.workspaceId, request.params.fileId);
  if (!file || file.deletedAt) return response.status(404).json({ error: 'File not found.' });
  try {
    const bytes = await getFileStorage().get(file.storageKey);
    const result = await scanUpload(bytes);
    updateStoredFileScan(request.user.workspaceId, file.id, request.user.userId, result.status, result.engine, result.detail || '',request.get('origin')||request.get('referer')||null);
    return response.json({ data: { fileId: file.id, scanStatus: result.status, scanner: result.engine } });
  } catch (error) {
    updateStoredFileScan(request.user.workspaceId, file.id, request.user.userId, 'quarantined', 'unavailable', error.message,request.get('origin')||request.get('referer')||null);
    return response.status(503).json({ error: 'A configured file scanner is required before this file can be marked clean.' });
  }
});

filesRouter.get('/:fileId/download', async (request, response, next) => {
  try {
    const file = getStoredFile(request.user.workspaceId, request.params.fileId);
    if (!validToken(request.query.token, request.params.fileId, request) || !mayOpen(file, request)) return response.status(404).json({ error: 'File not found or unavailable.' });
    const bytes = await getFileStorage().get(file.storageKey);
    recordFileAction({ workspaceId: request.user.workspaceId, fileId: file.id, actorId: request.user.userId, action: 'download', details: { checksum: file.checksum },requestOrigin:request.get('origin')||request.get('referer')||null });
    const safeName = file.originalName.replace(/[\r\n\0"\\/]/g, '_').slice(0, 180) || 'download.txt';
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return response.status(200).send(bytes);
  } catch (error) { return next(error); }
});
