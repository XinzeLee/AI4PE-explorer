// Separate AI4PE totals in the existing counter database. No workshop rows are changed.
const PREFIX = '/ai4pe/v1/';

function allowedOrigin(origin) {
  if (origin === 'https://xinzelee.github.io') return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(allowedOrigin(origin) ? cors(origin) : {}) },
  });
}

async function totals(db) {
  const row = await db.prepare('SELECT visits, likes, updated_at FROM ai4pe_totals WHERE id = 1').first();
  if (!row) throw new Error('Counter schema is not initialized');
  return { visits: row.visits, likes: row.likes, updatedAt: row.updated_at };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return json({ error: 'Not found' }, 404, origin);
    const action = url.pathname.slice(PREFIX.length);
    if (request.method === 'OPTIONS') {
      return allowedOrigin(origin) ? new Response(null, { status: 204, headers: cors(origin) }) : json({ error: 'Origin not allowed' }, 403, origin);
    }
    try {
      if (request.method === 'GET' && action === 'counts') return json(await totals(env.DB), 200, origin);
      if (request.method !== 'POST' || !['visit', 'like'].includes(action)) return json({ error: 'Not found' }, 404, origin);
      if (!allowedOrigin(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
      if (Number(request.headers.get('Content-Length') || 0) > 1000) return json({ error: 'Payload too large' }, 413, origin);
      const text = await request.text();
      if (text.length > 1000) return json({ error: 'Payload too large' }, 413, origin);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }
      if (!/^[a-zA-Z0-9_-]{16,80}$/.test(body?.token || '')) return json({ error: 'Invalid action token' }, 400, origin);
      // The primary key and trigger atomically increment only the first attempt.
      await env.DB.prepare('INSERT OR IGNORE INTO ai4pe_actions (kind, token, created_at) VALUES (?1, ?2, ?3)')
        .bind(action, body.token, new Date().toISOString()).run();
      return json(await totals(env.DB), 200, origin);
    } catch (error) {
      console.error('AI4PE counter failed', error);
      return json({ error: 'Counter temporarily unavailable' }, 503, origin);
    }
  },
};
