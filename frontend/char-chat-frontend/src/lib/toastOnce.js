const seen = new Map(); // key -> expireAt(ms)

export function showToastOnce({ key, message, type = 'info', ttlMs = 4000 }) {
  try {
    const now = Date.now();
    const expireAt = seen.get(key);
    if (expireAt && expireAt > now) return;
    seen.set(key, now + ttlMs);
    window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
  } catch (_) {
    // no-op
  }
}





