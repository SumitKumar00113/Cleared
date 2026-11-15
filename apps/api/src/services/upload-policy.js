export function rejectDisabledUploads(request, response, next) {
  const uploadsEnabled = process.env.NODE_ENV !== 'production' || process.env.FILE_UPLOADS_ENABLED === 'true';
  if (uploadsEnabled) return next();

  // Reviews can still be submitted as plain text, but multipart requests may
  // contain attachments and are rejected before Multer reads them.
  if (request.is('multipart/form-data')) {
    return response.status(503).json({ error: 'File uploads are disabled on this demo deployment.' });
  }
  return next();
}

export function rejectDisabledSourceUploads(_request, response, next) {
  const uploadsEnabled = process.env.NODE_ENV !== 'production' || process.env.FILE_UPLOADS_ENABLED === 'true';
  if (!uploadsEnabled) return response.status(503).json({ error: 'Source file uploads are disabled on this demo deployment.' });
  return next();
}
