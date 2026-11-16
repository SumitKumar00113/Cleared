import nodemailer from 'nodemailer';

let transport;
let gmailAccessToken = '';
let gmailAccessTokenExpiresAt = 0;
export const developmentOutbox = [];

function gmailApiSettings() {
  const names = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];
  const configured = names.filter((name) => Boolean(process.env[name])).length;
  if (configured && configured !== names.length) throw new Error('Gmail API mail requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN.');
  return configured === names.length;
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  if (process.env.NODE_ENV !== 'production') return null;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!smtpConfigured() || !process.env.MAIL_FROM) throw new Error('Production email delivery is not configured.');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function getGmailAccessToken() {
  if (gmailAccessToken && gmailAccessTokenExpiresAt > Date.now() + 60_000) return gmailAccessToken;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) {
    const error = new Error(`Google OAuth token request failed with HTTP ${response.status}.`);
    error.code = 'GMAIL_OAUTH';
    error.responseCode = response.status;
    error.command = 'TOKEN';
    error.detail = String(token.error || token.error_description || '').slice(0, 80) || undefined;
    throw error;
  }
  gmailAccessToken = token.access_token;
  gmailAccessTokenExpiresAt = Date.now() + Math.max(0, Number(token.expires_in) || 3600) * 1000;
  return gmailAccessToken;
}

function headerValue(value, name) {
  const safe = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  if (!safe) throw new Error(`Email ${name} is required.`);
  return safe;
}

function gmailRawMessage({ to, subject, text }) {
  const body = Buffer.from(String(text), 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const mime = [
    `From: ${headerValue(process.env.MAIL_FROM, 'sender')}`,
    `To: ${headerValue(to, 'recipient')}`,
    `Subject: =?UTF-8?B?${Buffer.from(headerValue(subject, 'subject'), 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

async function sendWithGmailApi(message) {
  const accessToken = await getGmailAccessToken();
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: gmailRawMessage(message) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const reason = result.error?.status || result.error?.errors?.[0]?.reason;
    const error = new Error(`Gmail API send request failed with HTTP ${response.status}.`);
    error.code = 'GMAIL_API';
    error.responseCode = response.status;
    error.command = 'SEND';
    error.detail = reason ? String(reason).slice(0, 80) : undefined;
    throw error;
  }
  return response.json();
}

export async function sendMail({ to, subject, text }) {
  if (process.env.NODE_ENV !== 'production') {
    // Development delivery is intentionally visible so local flows can be exercised.
    developmentOutbox.push({ to, subject, text, createdAt: new Date().toISOString() });
    if (developmentOutbox.length > 1000) developmentOutbox.shift();
    process.stdout.write(`[mail development] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { accepted: true, development: true };
  }
  if (!process.env.MAIL_FROM) throw new Error('Production email delivery requires MAIL_FROM.');
  if (gmailApiSettings()) return sendWithGmailApi({ to, subject, text });
  transport ||= createTransport();
  return transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}

export async function verifyMailerConfiguration() {
  if (process.env.NODE_ENV !== 'production') return true;
  if (gmailApiSettings()) { await getGmailAccessToken(); return true; }
  transport ||= createTransport();
  await transport.verify();
  return true;
}
