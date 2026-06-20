// Admin API — domain fix CRUD + KV management
// All endpoints require the ADMIN_SECRET env var as Bearer token.

const REDIS_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_SECRET = (process.env.ADMIN_SECRET || 'changeme').trim();

async function kv(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('KV not configured');
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([command, ...args]),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result ?? null;
}

function kvGet(k)           { return kv('GET', k); }
function kvSet(k, v)        { return kv('SET', k, v); }
function kvDel(k)           { return kv('DEL', k); }
function kvSMembers(k)      { return kv('SMEMBERS', k); }
function kvSAdd(k, v)       { return kv('SADD', k, v); }
function kvSRem(k, v)       { return kv('SREM', k, v); }

function readBody(req) {
  return new Promise(resolve => {
    if (req.body) return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

function normaliseHostname(raw) {
  try {
    const s = raw.startsWith('http') ? raw : 'https://' + raw;
    return new URL(s).hostname.replace(/^www\./, '').toLowerCase().trim();
  } catch { return raw.toLowerCase().replace(/^www\./, '').trim(); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth — simple Bearer token check
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (auth !== ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const body = req.method !== 'GET' ? await readBody(req) : {};
  const { action } = body;

  // ── List all domain fixes (KV + hardcoded seed count) ─────────────────────
  if (req.method === 'GET' || action === 'list') {
    try {
      const members = await kvSMembers('domainfix:index') || [];
      const fixes = await Promise.all(
        members.map(async hostname => {
          const raw = await kvGet(`domainfix:${hostname}`);
          try { return { hostname, ...JSON.parse(raw) }; } catch { return { hostname }; }
        })
      );
      fixes.sort((a, b) => {
        // admin-set first, then auto-learned, then by hostname
        if (a.source === 'admin' && b.source !== 'admin') return -1;
        if (b.source === 'admin' && a.source !== 'admin') return 1;
        return a.hostname.localeCompare(b.hostname);
      });
      return res.status(200).json({ fixes });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Set (upsert) a domain fix ──────────────────────────────────────────────
  if (action === 'set') {
    const { hostname: rawHost, primary, categories, niche, summary } = body;
    if (!rawHost || !primary) return res.status(400).json({ error: 'hostname and primary required' });
    const hostname = normaliseHostname(rawHost);
    const fix = {
      primary,
      categories: categories || [primary],
      niche: niche || '',
      summary: summary || '',
      source: 'admin',
      updatedAt: new Date().toISOString(),
    };
    try {
      await kvSet(`domainfix:${hostname}`, JSON.stringify(fix));
      await kvSAdd('domainfix:index', hostname);
      // Bust the result cache for this domain so next analysis picks up the fix
      await kv('DEL', `result:https://${hostname}`).catch(() => {});
      await kv('DEL', `result:https://www.${hostname}`).catch(() => {});
      return res.status(200).json({ ok: true, hostname, fix });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Delete a domain fix ────────────────────────────────────────────────────
  if (action === 'delete') {
    const { hostname: rawHost } = body;
    if (!rawHost) return res.status(400).json({ error: 'hostname required' });
    // Use exact key as passed (no normalisation) so the UI can delete www. entries
    const hostname = rawHost.toLowerCase().trim();
    try {
      await kvDel(`domainfix:${hostname}`);
      await kvSRem('domainfix:index', hostname);
      return res.status(200).json({ ok: true, hostname });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'unknown_action' });
};
