let csrfToken;
const apiBase = process.env.CLEARED_API_HOST
  ? `https://${process.env.CLEARED_API_HOST.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  : '';
const apiUrl = (url) => `${apiBase}${url}`;

export async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) {
      const csrfResponse = await fetch(apiUrl('/api/auth/csrf'), { credentials: 'include' });
      if (!csrfResponse.ok) throw new Error('Could not verify this request. Refresh the page and try again.');
      csrfToken = (await csrfResponse.json()).token;
    }
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(apiUrl(url), { ...options, headers, credentials: 'include' });
  if (response.status === 403 && !['GET', 'HEAD', 'OPTIONS'].includes(method)) csrfToken = undefined;
  if (/\/api\/auth\/(login|workspaces|invitations\/accept|mfa\/challenge|logout|logout-everywhere)$/.test(url) && response.ok) csrfToken = undefined;
  return response;
}

export async function apiFetchRecent(url, options = {}) {
  let response = await apiFetch(url, options);
  if (response.status !== 428) return response;
  const password = window.prompt('Confirm your password to continue.');
  if (!password) return response;
  const confirmed = await apiFetch('/api/auth/reauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!confirmed.ok) return confirmed;
  return apiFetch(url, options);
}
