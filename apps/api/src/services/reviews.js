import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { getReview, getReviews, saveReview } from './store.js';
import { requireRecentAuth, requireRole } from './auth.js';

export const reviewsRouter = Router();

const here = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = path.resolve(here, '../../uploads/reviews');
await mkdir(uploadDirectory, { recursive: true });
const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.csv']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedExtensions.has(path.extname(file.originalname).toLowerCase())) return callback(new Error('Use a PDF, DOCX, DOC, TXT, MD, or CSV file.'));
    callback(null, true);
  },
});

reviewsRouter.get('/', (request, response) => {
  const reviews = getReviews(request.user.workspaceId);
  const visible = request.user.role === 'creator' ? reviews.filter((review) => review.ownerId === request.user.userId) : reviews;
  return response.json({ data: visible });
});

reviewsRouter.post('/', requireRole(['owner','administrator','brand_manager','creator']), upload.single('file'), async (request, response) => {
  const title = String(request.body?.title || '').trim();
  const content = String(request.body?.content || '').trim();
  if (!title || (!content && !request.file)) return response.status(400).json({ error: 'A title and draft text or document are required.' });
  const extension = request.file ? path.extname(request.file.originalname).toLowerCase() : '';
  const draftText = content || (['.txt', '.md', '.csv'].includes(extension) ? await readFile(request.file.path, 'utf8') : `Document attached: ${request.file.originalname}`);
  const review = { id: randomUUID(), workspaceId: request.user.workspaceId, title, content: draftText, fileName: request.file?.originalname, owner: request.user.email, ownerId: request.user.userId, team: 'Unassigned', status: 'In review', date: new Date().toISOString(), findings: 0 };
  saveReview(request.user.workspaceId, review);
  return response.status(201).json({ data: review });
});

reviewsRouter.patch('/:id', (request, response, next) => request.body?.status === 'Approved' ? requireRecentAuth(request, response, next) : next(), (request, response) => {
  const review = getReview(request.user.workspaceId, request.params.id);
  if (!review) return response.status(404).json({ error: 'Review not found.' });
  if (request.user.role === 'creator' && review.ownerId !== request.user.userId) return response.status(404).json({ error: 'Review not found.' });
  const allowed = ['In review', 'Needs changes', 'Approved', 'Rejected'];
  if (!allowed.includes(request.body?.status)) return response.status(400).json({ error: 'Choose a valid review status.' });
  if (request.body.status === 'Approved' && Number(review.findings || 0) > 0) {
    return response.status(409).json({ error: 'Resolve the recorded findings before approving this review.' });
  }
  if (['Approved','Rejected','Needs changes'].includes(request.body.status) && !['owner','administrator','brand_manager','reviewer'].includes(request.user.role)) return response.status(403).json({ error: 'A reviewer or workspace manager must record this decision.' });
  review.status = request.body.status;
  saveReview(request.user.workspaceId, review);
  return response.json({ data: review });
});
