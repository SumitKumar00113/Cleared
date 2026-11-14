import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { getReview, getReviews, getStoredFile, reviewHistory, saveReview } from './store.js';
import { requireRecentAuth, requireRole } from './auth.js';
import { readCleanFile, storeTextUpload } from './private-files.js';
import { validateTextUpload } from './file-validation.js';

export const reviewsRouter = Router();
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const allowedExtensions = new Set(['.txt', '.md', '.csv']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1 }, fileFilter: (_request, file, callback) => {
  const extension = String(file.originalname || '').toLowerCase().match(/\.[^.\\/]+$/)?.[0] || '';
  if (!allowedExtensions.has(extension)) return callback(Object.assign(new Error('Use a TXT, MD, or CSV review draft.'), { status: 415 }));
  callback(null, true);
} });

async function visibleReview(request, review) {
  if (!review?.fileId) return review;
  const file = getStoredFile(request.user.workspaceId, review.fileId);
  if (!file || file.scanStatus !== 'clean' || file.deletedAt) return { ...review, content: review.content || '', attachmentScanStatus: 'quarantined' };
  if (review.content) return { ...review, attachmentScanStatus: file.scanStatus };
  const bytes = await readCleanFile(file);
  const extension = path.extname(file.originalName).toLowerCase();
  const { text } = validateTextUpload(bytes, extension);
  return { ...review, content: text };
}

reviewsRouter.get('/', async (request, response, next) => {
  try {
    const reviews = getReviews(request.user.workspaceId);
    const visible = request.user.role === 'creator' ? reviews.filter((review) => review.ownerId === request.user.userId) : reviews;
    return response.json({ data: await Promise.all(visible.map((review) => visibleReview(request, review))) });
  } catch (error) { return next(error); }
});

reviewsRouter.get('/:id/history', (request, response) => {
  const review=getReview(request.user.workspaceId,request.params.id);
  if(!review || (request.user.role==='creator' && review.ownerId!==request.user.userId)) return response.status(404).json({error:'Review not found.'});
  return response.json({data:reviewHistory(request.user.workspaceId,request.params.id)});
});

reviewsRouter.post('/', requireRole(['owner','administrator','brand_manager','creator']), upload.single('file'), async (request, response) => {
  const title = String(request.body?.title || '').trim();
  const content = String(request.body?.content || '').trim();
  if (!title || (!content && !request.file)) return response.status(400).json({ error: 'A title and draft text or document are required.' });
  let file;
  try {
    const id = randomUUID();
    let draftText = content;
    if (request.file) {
      file = await storeTextUpload({ upload: request.file, request, purpose: 'review', resourceId: id, ownerId: request.user.userId });
      if (!draftText && file.record.scanStatus === 'clean') draftText = file.text;
    }
    const review = { id, workspaceId: request.user.workspaceId, title, content: draftText, fileId: file?.record.id, fileName: file?.record.originalName, attachmentScanStatus: file?.record.scanStatus, owner: request.user.email, ownerId: request.user.userId, team: 'Unassigned', status: 'In review', date: new Date().toISOString(), findings: 0 };
    saveReview(request.user.workspaceId, review, request.user.userId, request.get('origin') || request.get('referer'));
    return response.status(201).json({ data: review });
  } catch (error) {
    return response.status(error.status || 400).json({ error: error.message || 'Could not store this review.' });
  }
});

reviewsRouter.patch('/:id', (request, response, next) => request.body?.status === 'Approved' ? requireRecentAuth(request, response, next) : next(), (request, response) => {
  const review = getReview(request.user.workspaceId, request.params.id);
  if (!review) return response.status(404).json({ error: 'Review not found.' });
  if (request.user.role === 'creator' && review.ownerId !== request.user.userId) return response.status(404).json({ error: 'Review not found.' });
  const allowed = ['In review', 'Needs changes', 'Approved', 'Rejected'];
  if (request.body?.content !== undefined && typeof request.body.content !== 'string') return response.status(400).json({error:'Draft text must be plain text.'});
  if (!request.body?.status && request.body?.content === undefined) return response.status(400).json({ error: 'Choose a valid review status or draft text.' });
  if (request.body?.status && !allowed.includes(request.body.status)) return response.status(400).json({ error: 'Choose a valid review status.' });
  if (request.body?.content !== undefined) review.content=request.body.content;
  if (!request.body?.status) { saveReview(request.user.workspaceId,review,request.user.userId,request.get('origin') || request.get('referer')); return response.json({data:getReview(request.user.workspaceId,review.id)}); }
  if (request.body.status === 'Approved' && Number(review.findings || 0) > 0) return response.status(409).json({ error: 'Resolve the recorded findings before approving this review.' });
  if (['Approved','Rejected','Needs changes'].includes(request.body.status) && !['owner','administrator','brand_manager','reviewer'].includes(request.user.role)) return response.status(403).json({ error: 'A reviewer or workspace manager must record this decision.' });
  if (['Approved','Rejected'].includes(request.body.status) && review.ownerId===request.user.userId) return response.status(403).json({error:'You cannot approve or reject your own submission.'});
  review.status = request.body.status;
  saveReview(request.user.workspaceId, review, request.user.userId, request.get('origin') || request.get('referer'));
  return response.json({ data: getReview(request.user.workspaceId,review.id) });
});
