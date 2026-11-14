import { TextDecoder } from 'node:util';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
export const TEXT_TYPES = new Map([
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
]);

export function validateTextUpload(buffer, extension) {
  const contentType = TEXT_TYPES.get(String(extension || '').toLowerCase());
  if (!contentType) throw Object.assign(new Error('Only TXT, MD, and CSV files are supported.'), { status: 415 });
  let text;
  try { text = textDecoder.decode(buffer); }
  catch { throw Object.assign(new Error('The uploaded file must be valid UTF-8 text.'), { status: 400 }); }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text)) throw Object.assign(new Error('Binary content is not allowed. Upload a UTF-8 TXT, MD, or CSV file.'), { status: 400 });
  for (const byte of buffer) {
    if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127) {
      throw Object.assign(new Error('Binary content is not allowed. Upload a UTF-8 TXT, MD, or CSV file.'), { status: 400 });
    }
  }
  if (!text.trim()) throw Object.assign(new Error('The uploaded text file is empty.'), { status: 400 });
  return { text, contentType };
}
