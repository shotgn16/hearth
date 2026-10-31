// Shared helpers: API client, state, formatting, sheets, toasts, icons.
export const state = { me: null, cats: [], people: [], accounts: [], users: [], tags: [], events: [], inboxCount: 0 };

export function token() { try { return localStorage.getItem('hl_token'); } catch { return null; } }
export function setToken(t) { try { t ? localStorage.setItem('hl_token', t) : localStorage.removeItem('hl_token'); } catch {} }
export function fingerprint() {
  try { let f = localStorage.getItem('hl_device'); if (!f) { f = crypto.randomUUID(); localStorage.setItem('hl_device', f); } return f; } catch { return 'no-storage'; }
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const r = await fetch(`api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !path.startsWith('/login')) { setToken(null); location.hash = '#/'; location.reload(); throw new Error('Signed out'); }
  if (raw) return r;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export async function loadRefs() {
  const [cats, people, accounts, users, tags] = await Promise.all([api('/categories'), api('/people'), api('/accounts'), api('/users'), api('/tags')]);
  Object.assign(state, { cats, people, accounts, users, tags });
}
export const cat = (id) => state.cats.find((c) => c.id === id);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n, { dp = 2, sign = false } = {}) => {
  if (n == null || isNaN(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}£${s}`;
};
export const fmt0 = (n) => fmt(n, { dp: 0 });
export const amt = (n) => `<span class="money ${n > 0 ? 'in' : ''}">${n > 0 ? '+' : ''}${fmt(Math.abs(n))}</span>`;
export const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const niceDate = (s, opts = { day: 'numeric', month: 'short' }) => new Date(`${String(s).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', opts);
export const relDay = (s) => {
  const d = Math.round((new Date(`${String(s).slice(0, 10)}T12:00:00`) - new Date(`${iso()}T12:00:00`)) / 86400000);
  if (d === 0) return 'Today'; if (d === -1) return 'Yesterday'; if (d === 1) return 'Tomorrow';
  if (d > 1 && d < 7) return niceDate(s, { weekday: 'long' });
  return niceDate(s, { weekday: 'short', day: 'numeric', month: 'short', ...(String(s).slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
};
export const catIcon = (c, size = 38) => `<span class="ico" style="width:${size}px;height:${size}px;background:${c?.color || '#94a3b8'}22;color:${c?.color || '#94a3b8'}">${esc(c?.icon || '•')}</span>`;
export const opts = (list, sel, label = (x) => x.name, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ''}${list.map((x) => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}`;

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
export function on(root, event, sel, fn) { root.addEventListener(event, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); }); }

export function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
export function fail(e) { toast(e.message || String(e), 4000); }

export function sheet(html, { wide = false, onClose } = {}) {
  const s = document.createElement('div'); s.className = 'scrim';
  s.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const close = () => { s.remove(); document.removeEventListener('keydown', key); onClose?.(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', key);
  document.body.append(s);
  setTimeout(() => s.querySelector('input:not([type=hidden]),select,textarea,button.btn')?.focus(), 60);
  return { el: s.querySelector('.sheet'), close };
}
export const formData = (form) => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, v === '' ? null : v]));

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  home: P('<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>'),
  money: P('<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10h18M7 15h3"/>'),
  plan: P('<path d="M12 3v18M5 8h9a3 3 0 0 1 0 6H8"/><circle cx="12" cy="12" r="9"/>'),
  insights: P('<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'),
  more: P('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  jot: P('<path d="M12 5v14M5 12h14"/>'),
  inbox: P('<path d="M4 13h4l2 3h4l2-3h4M5 5h14l1 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z"/>'),
  calendar: P('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
  repeat: P('<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>'),
  tag: P('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
  ai: P('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  watch: P('<path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>'),
  note: P('<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>'),
  grid: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>'),
  list: P('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  bell: P('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
};
