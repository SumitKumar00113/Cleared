import express from 'express';
import cors from 'cors';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewsRouter } from './services/reviews.js';
import { sourcesRouter } from './services/sources.js';
import { authRouter, requireAuth } from './services/auth.js';
import { verificationRouter } from './services/verification.js';
import { workspaceRouter } from './services/workspace.js';

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
try {
  const envText = await readFile(rootEnv, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* Environment variables may be supplied by the host instead. */ }

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'cleared-api' }));
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api/workspace', workspaceRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/verification', verificationRouter);
app.use((error, _request, response, _next) => {
  console.error(error);
  if (error.name === 'MulterError') return response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 20 MB or smaller.' : 'Upload one file at a time.' });
  if (error.message.startsWith('Use a ')) return response.status(400).json({ error: error.message });
  response.status(500).json({ error: 'The request could not be completed.' });
});

app.listen(port, () => console.log(`Cleared API listening on http://localhost:${port}`));
