import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { getSources, saveSource } from './store.js';
import { requireRole } from './auth.js';

export const sourcesRouter = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = path.resolve(here, '../../uploads');
await mkdir(uploadDirectory, { recursive: true });
const allowedExtensions = new Set(['.txt', '.md', '.csv']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedExtensions.has(path.extname(file.originalname).toLowerCase())) return callback(new Error('Use a TXT, MD, or CSV approved source.'));
    callback(null, true);
  },
});

sourcesRouter.get('/', (request, response) => response.json({ data: getSources(request.user.workspaceId) }));
sourcesRouter.post('/', requireRole(['owner','administrator','brand_manager']), upload.single('file'), async (request, response) => {
  const name = String(request.body?.name || '').trim();
  const category = String(request.body?.category || '').trim();
  if (!name || !category || !request.file) return response.status(400).json({ error: 'A source name, collection, and file are required.' });
  const extension = path.extname(request.file.originalname).toLowerCase();
  const text = ['.txt', '.md', '.csv'].includes(extension) ? await readFile(request.file.path, 'utf8') : '';
  const source = { id: randomUUID(), workspaceId: request.user.workspaceId, version: 1, name, category, updated: new Date().toISOString(), owner: request.user.email, type: extension.slice(1).toUpperCase(), fileName: request.file.originalname, size: request.file.size, text };
  saveSource(request.user.workspaceId, source);
  return response.status(201).json({ data: source });
});
