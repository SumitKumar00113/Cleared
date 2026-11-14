let csrfToken;

export async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      if (!csrfResponse.ok) throw new Error('Could not verify this request. Refresh the page and try again.');
      csrfToken = (await csrfResponse.json()).token;
    }
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 403 && !['GET', 'HEAD', 'OPTIONS'].includes(method)) csrfToken = undefined;
  if (/\/api\/auth\/(login|workspaces|invitations\/accept)$/.test(url) && response.ok) csrfToken = undefined;
  return response;
}
