import '../env.js';
import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const localRoot = path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(here, '../../private-storage'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => createHmac('sha256', key).update(value).digest(encoding);
function localPath(key) {
  if (!/^[0-9a-f-]{36}$/i.test(key)) throw new Error('Invalid private object key.');
  const resolved = path.resolve(localRoot, key);
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error('Invalid private object key.');
  return resolved;
}

function createLocalStorage() {
  return {
    driver: 'local',
    async put(key, bytes) { await mkdir(localRoot, { recursive: true }); await writeFile(localPath(key), bytes, { flag: 'wx', mode: 0o600 }); },
    async get(key) { return readFile(localPath(key)); },
    async delete(key) { try { await unlink(localPath(key)); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
  };
}

function createS3Storage(env = process.env) {
  const endpoint = env.S3_ENDPOINT?.replace(/\/$/, '');
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION || 'us-east-1';
  const accessKey = env.S3_ACCESS_KEY_ID;
  const secretKey = env.S3_SECRET_ACCESS_KEY;
  const sessionToken = env.S3_SESSION_TOKEN;
  if (!endpoint || !bucket || !accessKey || !secretKey) throw new Error('S3 storage requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.');
  const baseUrl = new URL(endpoint);
  if (baseUrl.protocol !== 'https:' && env.NODE_ENV === 'production') throw new Error('Production S3_ENDPOINT must use HTTPS.');
  const host = baseUrl.host;
  const service = 's3';
  async function send(method, key, bytes) {
    const url = new URL(`${endpoint}/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`);
    const payload = bytes || Buffer.alloc(0);
    const payloadHash = sha256(payload);
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.slice(0, 8);
    const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': timestamp };
    if (sessionToken) headers['x-amz-security-token'] = sessionToken;
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name].trim()}\n`).join('');
    const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
    const dateKey = hmac(`AWS4${secretKey}`, date);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, service);
    const signingKey = hmac(serviceKey, 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign, 'hex')}`;
    if (method === 'PUT') headers['content-type'] = 'application/octet-stream';
    const response = await fetch(url, { method, headers, ...(method === 'PUT' ? { body: payload } : {}) });
    if (!response.ok) throw new Error(`Private S3 storage ${method} failed with HTTP ${response.status}.`);
    return method === 'GET' ? Buffer.from(await response.arrayBuffer()) : undefined;
  }
  return { driver: 's3', put: (key, bytes) => send('PUT', key, bytes), get: (key) => send('GET', key), delete: (key) => send('DELETE', key) };
}

let selected;
export function getFileStorage() {
  if (!selected) {
    const driver = process.env.FILE_STORAGE || (process.env.NODE_ENV === 'production' ? 's3' : 'local');
    if (driver === 'local') {
      if (process.env.NODE_ENV === 'production') throw new Error('Production must use private S3-compatible FILE_STORAGE=s3.');
      selected = createLocalStorage();
    } else if (driver === 's3') selected = createS3Storage();
    else throw new Error('FILE_STORAGE must be local or s3.');
  }
  return selected;
}

export function resetFileStorageForTests() { selected = undefined; }
