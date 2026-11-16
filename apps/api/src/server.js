import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewsRouter } from './services/reviews.js';
import { sourcesRouter } from './services/sources.js';
import { authRouter, csrfProtection, requireWorkspaceAuth } from './services/auth.js';
import { verificationRouter } from './services/verification.js';
import { notificationsRouter } from './services/notifications.js';
import { workspaceRouter } from './services/workspace.js';
import { filesRouter } from './services/files.js';
import { encryptionKey } from './services/mfa.js';
import { recordAuditEvent } from './services/store.js';

export function validateEnvironment(env = process.env) {
  if (env.NODE_ENV === 'production') {
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || new Set(env.SESSION_SECRET).size < 12 || /^(change.?me|secret|password|your)/i.test(env.SESSION_SECRET)) throw new Error('Production requires a strong SESSION_SECRET of at least 32 characters.');
    const origins = env.CORS_ORIGINS?.split(',').map((item) => item.trim()).filter(Boolean) || [];
    if (!origins.length) throw new Error('Production requires a CORS_ORIGINS allow-list.');
    for (const origin of origins) {
      let parsed;
      try { parsed = new URL(origin); } catch { throw new Error('Every CORS_ORIGINS entry must be an exact origin.'); }
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin || origin === '*' || parsed.username || parsed.password) throw new Error('Every CORS_ORIGINS entry must be an exact origin.');
      if (parsed.protocol !== 'https:') throw new Error('Production CORS_ORIGINS entries must use HTTPS.');
    }
    let appBase;
    try { appBase = new URL(env.APP_BASE_URL); } catch { throw new Error('Production requires an HTTPS APP_BASE_URL.'); }
    if (appBase.protocol !== 'https:' || appBase.origin !== env.APP_BASE_URL.replace(/\/$/, '') || appBase.username || appBase.password) throw new Error('Production APP_BASE_URL must be an exact HTTPS origin.');
    for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) if (!env[name]) throw new Error(`Production requires ${name}.`);
    if (!Number.isInteger(Number(env.SMTP_PORT)) || Number(env.SMTP_PORT) < 1 || Number(env.SMTP_PORT) > 65535) throw new Error('Production requires a valid SMTP_PORT.');
    try { encryptionKey(env.MFA_ENCRYPTION_KEY); } catch { throw new Error('Production requires a valid 32-byte MFA_ENCRYPTION_KEY.'); }
    if ((env.FILE_STORAGE || 's3') !== 's3') throw new Error('Production requires private S3-compatible FILE_STORAGE=s3.');
    for (const name of ['S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY']) if (!env[name]) throw new Error(`Production requires ${name}.`);
    try { if (new URL(env.S3_ENDPOINT).protocol !== 'https:') throw new Error(); } catch { throw new Error('Production requires an HTTPS S3_ENDPOINT.'); }
    const uploadsEnabled = env.FILE_UPLOADS_ENABLED === 'true';
    if (uploadsEnabled && (env.FILE_SCANNER !== 'clamav' || !env.CLAMAV_HOST)) throw new Error('Production file uploads require FILE_SCANNER=clamav and CLAMAV_HOST.');
    if (uploadsEnabled && (!Number.isInteger(Number(env.CLAMAV_PORT || 3310)) || Number(env.CLAMAV_PORT || 3310) < 1 || Number(env.CLAMAV_PORT || 3310) > 65535)) throw new Error('Production file uploads require a valid CLAMAV_PORT.');
  }
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32 && env.NODE_ENV !== 'production') throw new Error('SESSION_SECRET must be at least 32 characters when configured.');
  return true;
}
validateEnvironment();

const defaultOrigins = process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = new Set(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean) : defaultOrigins);

export function createApp() {
  const app = express();
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(cors({ credentials: true, origin(origin, callback) { if (!origin || allowedOrigins.has(origin)) return callback(null, true); return callback(null, false); }, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-CSRF-Token'] }));
  app.use(express.json({ limit: '2mb' }));
  app.use(csrfProtection);
  app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'cleared-api' }));
  app.use('/api/auth', authRouter);
  app.use('/api', requireWorkspaceAuth);
  app.use('/api', (request,response,next)=>{
    response.on('finish',()=>{
      const path=request.path, method=request.method;
      let action=`api.${method.toLowerCase()}`;
      if(path.startsWith('/verification/check/'))action='verification.run';
      else if(path.startsWith('/workspace/invitations'))action='invitation.created';
      else if(path.startsWith('/workspace/members/')&&method==='PATCH')action='member.role_changed';
      else if(path.startsWith('/workspace/members/')&&method==='DELETE')action='member.removed';
      else if(path.startsWith('/auth/mfa/'))action='mfa.changed';
      else if(/^\/files\/[^/]+\/download$/.test(path))action='file.download';
      const routeTarget=response.statusCode>=400?request.route?.path||path.replace(/\/[^/]+/g,'/:id'):request.route?.path||path;
      recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:response.statusCode>=400?'api.route_access_denied':action,targetType:'route',targetId:routeTarget,requestOrigin:request.get('origin')||request.get('referer')||null,details:{method,status:response.statusCode}});
    });
    next();
  });
  app.use('/api/files', filesRouter);
  app.use('/api/workspace', workspaceRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/sources', sourcesRouter);
  app.use('/api/verification', verificationRouter);
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  app.use(express.static(webDist, { index: false }));
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) return next();
    return response.sendFile(path.join(webDist, 'index.html'), (error) => error && next(error));
  });
  app.use((error, _request, response, _next) => {
    if (error.name === 'MulterError') return response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 20 MB or smaller.' : 'Upload one file at a time.' });
    if (error.status) return response.status(error.status).json({ error: error.message });
    if (error.message.startsWith('Use a ')) return response.status(400).json({ error: error.message });
    if (process.env.NODE_ENV !== 'production') console.error('Request failed:', error);
    else console.error('Request failed:', error.name || 'Error');
    response.status(500).json({ error: 'The request could not be completed.' });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4000);
  createApp().listen(port, '0.0.0.0', () => console.log(`Cleared API listening on port ${port}`));
}
