import nodemailer from 'nodemailer';

let transport;
export const developmentOutbox = [];

function createTransport() {
  if (process.env.NODE_ENV !== 'production') return null;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM) {
    throw new Error('Production email delivery is not configured.');
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendMail({ to, subject, text }) {
  if (process.env.NODE_ENV !== 'production') {
    // Development delivery is intentionally visible so local flows can be exercised.
    developmentOutbox.push({ to, subject, text, createdAt: new Date().toISOString() });
    if (developmentOutbox.length > 1000) developmentOutbox.shift();
    process.stdout.write(`[mail development] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { accepted: true, development: true };
  }
  transport ||= createTransport();
  return transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}

export async function verifyMailerConfiguration() {
  if (process.env.NODE_ENV !== 'production') return true;
  transport ||= createTransport();
  await transport.verify();
  return true;
}
