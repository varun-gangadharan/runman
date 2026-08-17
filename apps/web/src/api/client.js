/**
 * Browser-side API client.
 *
 * There is deliberately no Strava client here. The browser talks only to this
 * app's own functions; those hold the credentials and talk to Strava. Auth
 * travels in an httpOnly cookie, so there is no token for this code to read,
 * store, or leak.
 */

/** Thrown for any non-2xx response, carrying the server's machine-readable code. */
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });

  if (response.status === 204) return null;

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new ApiError(
      body?.message ?? `Request to ${path} failed with ${response.status}`,
      response.status,
      body?.error ?? 'unknown',
    );
  }
  return body;
}

export const api = {
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  /** @param {{ days?: number, limit?: number }} options */
  activities: (options = {}) => {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request(`/api/activities${query ? `?${query}` : ''}`);
  },

  /** @param {boolean} full Walk the whole history rather than syncing incrementally. */
  sync: (full = false) => request(`/api/sync${full ? '?full=1' : ''}`, { method: 'POST' }),

  /**
   * Upload one batch of already-parsed activities from a Strava bulk export.
   * @param {object[]} activities
   * @param {boolean} final Marks the last batch, which settles the sync state.
   */
  importActivities: (activities, final) =>
    request('/api/import', { method: 'POST', body: JSON.stringify({ activities, final }) }),

  updateProfile: (patch) => request('/api/athlete', { method: 'PATCH', body: JSON.stringify(patch) }),

  keys: {
    list: () => request('/api/keys'),
    create: (name, expiresInDays) =>
      request('/api/keys', { method: 'POST', body: JSON.stringify({ name, expiresInDays }) }),
    revoke: (id) => request(`/api/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};

/** Where the browser goes to start the OAuth flow. */
export const LOGIN_URL = '/api/auth/login';
