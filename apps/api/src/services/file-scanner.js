import net from 'node:net';

function scanWithClamAv(bytes, env = process.env) {
  const host = env.CLAMAV_HOST;
  const port = Number(env.CLAMAV_PORT || 3310);
  if (!host || !Number.isInteger(port)) return Promise.reject(new Error('ClamAV scanner is not configured.'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks = [];
    let finished = false;
    const finish = (error, result) => { if (finished) return; finished = true; socket.destroy(); error ? reject(error) : resolve(result); };
    socket.setTimeout(Number(env.CLAMAV_TIMEOUT_MS || 10000), () => finish(new Error('ClamAV scanner timed out.')));
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8').trim();
      if (reply.endsWith(' OK')) finish(null, { status: 'clean', engine: 'clamav' });
      else if (reply.includes(' FOUND')) finish(null, { status: 'rejected', engine: 'clamav', detail: reply.slice(0, 500) });
      else finish(new Error(`ClamAV returned an unexpected result: ${reply.slice(0, 200)}`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        const part = bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.length));
        const length = Buffer.alloc(4); length.writeUInt32BE(part.length);
        socket.write(length); socket.write(part);
      }
      const end = Buffer.alloc(4); end.writeUInt32BE(0); socket.end(end);
    });
  });
}

export async function scanUpload(bytes, env = process.env) {
  const scanner = env.FILE_SCANNER || (env.CLAMAV_HOST ? 'clamav' : 'none');
  if (scanner === 'clamav') return scanWithClamAv(bytes, env);
  if (scanner !== 'none') throw new Error('FILE_SCANNER must be clamav or none.');
  if (env.NODE_ENV === 'production') throw new Error('Production cannot mark an upload clean without a configured scanner.');
  console.warn('[file scanner] WARNING: scanner not configured; development-only bypass marked upload clean.');
  return { status: 'clean', engine: 'development-no-scanner' };
}
