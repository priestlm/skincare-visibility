// Run history — stores and retrieves per-domain report summaries in KV.
// GET  /api/history?domain=pizzahut.co.uk  → { history: [...] }
// POST /api/history { domain, score, mentionCount, totalQ, competitors, missedQueries } → { ok: true }

const REDIS_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_RUNS = 6;

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

function readBody(req) {
  return new Promise(resolve => {
    if (req.body) return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

function normaliseDomain(raw) {
  if (!raw) return '';
  try {
    const s = raw.startsWith('http') ? raw : 'https://' + raw;
    return new URL(s).hostname.replace(/^www\./, '').toLowerCase().trim();
  } catch { return raw.toLowerCase().replace(/^www\./, '').trim(); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — fetch history for a domain ─────────────────────────────────────
  if (req.method === 'GET') {
    const domain = normaliseDomain(req.query?.domain || '');
    if (!domain) return res.status(400).json({ error: 'domain required' });
    try {
      const raw = await kv('GET', `history:${domain}`);
      const history = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ domain, history });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — save a run summary ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await readBody(req);
    const { domain: rawDomain, score, mentionCount, totalQ, competitors, missedQueries } = body;
    const domain = normaliseDomain(rawDomain);
    if (!domain) return res.status(400).json({ error: 'domain required' });

    const entry = {
      date: new Date().toISOString(),
      score: score || 0,
      mentionCount: mentionCount || 0,
      totalQ: totalQ || 0,
      competitors: (competitors || []).slice(0, 5).map(c => ({ name: c.name, count: c.count })),
      missedQueries: (missedQueries || []).slice(0, 30),
    };

    try {
      const raw = await kv('GET', `history:${domain}`);
      const history = raw ? JSON.parse(raw) : [];
      history.unshift(entry);          // newest first
      history.splice(MAX_RUNS);        // keep max 6
      await kv('SET', `history:${domain}`, JSON.stringify(history));
      return res.status(200).json({ ok: true, domain, runs: history.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
};
