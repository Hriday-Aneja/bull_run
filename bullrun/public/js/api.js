// Thin API client: sensible timeouts, friendly errors, never raw server or network text.
const TOKEN_KEY = 'bullrun.token';
export class ApiError extends Error { constructor(msg, status, kind) { super(msg); this.status = status; this.kind = kind; } }
export const auth = { get token() { return localStorage.getItem(TOKEN_KEY); }, set(t) { localStorage.setItem(TOKEN_KEY, t); }, clear() { localStorage.removeItem(TOKEN_KEY); } };
export async function req(path, method = 'GET', body, timeout = 15000) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(path, { method, signal: ctl.signal, headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: 'Bearer ' + auth.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) { /* non-JSON */ }
    if (!r.ok) {
      if (r.status === 401) { auth.clear(); throw new ApiError((j && j.error) || 'Please sign in to continue.', 401, 'auth'); }
      throw new ApiError((j && j.error) || 'Something went wrong. Your game is safe; please try again.', r.status, 'server');
    }
    return j;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw new ApiError('The game server is taking too long to answer. Your game is safe. Try again in a moment.', 0, 'timeout');
    throw new ApiError('Cannot reach the game server. Make sure it is still running, then retry. Your game is saved.', 0, 'network');
  } finally { clearTimeout(to); }
}
export const api = {
  login: (name) => req('/api/login', 'POST', { name }),
  health: () => req('/api/health'),
  sessions: () => req('/api/sessions'),
  create: (duration, seed, bots) => req('/api/sessions', 'POST', { duration, seed: seed || undefined, bots }, 25000),
  spoil: (id) => req(`/api/sessions/${id}/spoil`, 'POST', {}),
  ipoBid: (id, ipoId, lots) => req(`/api/sessions/${id}/ipobid`, 'POST', { ipoId, lots }),
  truth: (id) => req(`/api/sessions/${id}/truth`),
  get: (id, since) => req(`/api/sessions/${id}` + (since !== undefined ? `?since=${since}` : '')),
  advance: (id, ticks, since, stopOnBreaking = true) => req(`/api/sessions/${id}/advance`, 'POST', { ticks, since, stopOnBreaking }),
  nextDay: (id, since) => req(`/api/sessions/${id}/nextday`, 'POST', { since }),
  preview: (id, o) => req(`/api/sessions/${id}/orders/preview`, 'POST', o),
  order: (id, o, since) => req(`/api/sessions/${id}/orders`, 'POST', { ...o, since }),
  cancel: (id, orderId, since) => req(`/api/sessions/${id}/cancel`, 'POST', { orderId, since }),
  explain: (id, sid) => req(`/api/sessions/${id}/explain`, 'POST', { id: sid }, 12000),
  finish: (id, since) => req(`/api/sessions/${id}/finish`, 'POST', { since }),
  report: (id) => req(`/api/sessions/${id}/report`),
  createRoom: (duration, seed, speed, bots) => req('/api/rooms', 'POST', { duration, seed: seed || undefined, speed, bots }, 25000),
  joinRoom: (code) => req('/api/rooms/join', 'POST', { code }),
  control: (id, action, speed) => req(`/api/sessions/${id}/control`, 'POST', { action, speed }),
  poll: (id, since, rev) => req(`/api/sessions/${id}?since=${since}&rev=${rev}`, 'GET', undefined, 6000),
};
