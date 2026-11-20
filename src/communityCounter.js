const PREFIX = 'ai4pe-explorer-community-v1-';
const API = import.meta.env.VITE_COUNTER_API || 'https://ai4pe-counter.xinzelee.workers.dev/ai4pe/v1/';
const memory = {};
const listeners = new Set();
let started = false;
let busy = false;
let live = false;
let visible = false;
let timer;
let requestQueue = Promise.resolve();

function read(key, session = false) {
  try { return (session ? sessionStorage : localStorage).getItem(PREFIX + key) ?? memory[key] ?? null; }
  catch { return memory[key] ?? null; }
}
function write(key, value, session = false) {
  memory[key] = String(value);
  try { (session ? sessionStorage : localStorage).setItem(PREFIX + key, String(value)); } catch { /* Storage can be disabled. */ }
}
function identity(key, session = false) {
  let id = read(key, session);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    write(key, id, session);
  }
  return id;
}
function valid(data) {
  return data && Number.isSafeInteger(data.visits) && data.visits >= 0 && Number.isSafeInteger(data.likes) && data.likes >= 0;
}
let counts = null;
try { const saved = JSON.parse(read('counts') || 'null'); if (valid(saved)) counts = saved; } catch { /* Ignore corrupt cache. */ }
function notify() { for (const listener of listeners) listener(); }
function snapshot() {
  return { counts, live, busy, liked: read('liked') === '1', pending: !!read('pending-like') };
}
function request(path, body) {
  const current = requestQueue.then(() => performRequest(path, body));
  requestQueue = current.catch(() => {});
  return current;
}
async function performRequest(path, body) {
  if (navigator.onLine === false || location.protocol === 'file:') throw new Error('Offline');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(new URL(path, API), {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error('Counter unavailable');
    const data = await response.json();
    if (!valid(data)) throw new Error('Invalid counter response');
    counts = { visits: data.visits, likes: data.likes };
    live = true;
    write('counts', JSON.stringify(counts));
    notify();
  } finally { clearTimeout(timeout); }
}
function failed() { live = false; notify(); }
function schedule() {
  clearTimeout(timer);
  if (visible && !document.hidden && navigator.onLine !== false && !navigator.connection?.saveData) {
    timer = setTimeout(() => startOrReconnect(), 60000);
  }
}
async function syncLike() {
  const pending = read('pending-like');
  if (!pending || busy) return;
  busy = true; notify();
  try { await request('like', { token: pending }); write('pending-like', ''); }
  catch { failed(); }
  finally { busy = false; notify(); schedule(); }
}
async function startOrReconnect() {
  try {
    if (!read('visited', true)) {
      await request('visit', { token: identity('visit-token', true) });
      write('visited', '1', true);
    } else await request('counts');
  } catch { failed(); }
  await syncLike();
  schedule();
}
function start() {
  if (started) return;
  started = true;
  window.addEventListener('online', startOrReconnect);
  window.addEventListener('offline', failed);
  window.addEventListener('storage', notify);
  document.addEventListener('visibilitychange', schedule);
  startOrReconnect();
}
export function subscribeCounter(listener) { listeners.add(listener); start(); return () => listeners.delete(listener); }
export function getCounter() { return snapshot(); }
export function setCounterVisible(value) { visible = value; schedule(); }
export function likeExplorer() {
  if (read('liked') === '1' || busy) return;
  write('liked', '1'); write('pending-like', identity('like-token'));
  notify(); syncLike();
}
