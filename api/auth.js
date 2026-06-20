const crypto = require('crypto');

const REDIS_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([command, ...args]),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

function redisGet(key)                      { return redis('GET', key); }
function redisSet(key, value, exSeconds)    { return exSeconds ? redis('SET', key, value, 'EX', exSeconds) : redis('SET', key, value); }
function redisDel(key)                      { return redis('DEL', key); }

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function readBody(req) {
  return new Promise(resolve => {
    if (req.body) return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

function safeUser(user) {
  const { passwordHash, salt, ...rest } = user;
  return rest;
}

async function getSessionUser(req) {
  const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!auth) return null;
  const email = await redisGet(`session:${auth}`);
  if (!email) return null;
  const json = await redisGet(`user:${email}`);
  if (!json) return null;
  return JSON.parse(json);
}

const THIRTY_DAYS = 60 * 60 * 24 * 30;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'storage_unavailable' });
  }

  // ── GET /api/auth → return current user from token ──
  if (req.method === 'GET') {
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      return res.status(200).json({ user: safeUser(user) });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = await readBody(req);
  const { action } = body;

  // ── Register ──
  if (action === 'register') {
    const { email, password, name, orgUrl, orgName, previewData } = body;
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
    if (password.length < 6) return res.status(400).json({ error: 'password_too_short' });
    const emailKey = email.toLowerCase().trim();
    try {
      const existing = await redisGet(`user:${emailKey}`);
      if (existing) return res.status(409).json({ error: 'email_already_registered' });
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      const token = generateToken();
      const user = {
        email: emailKey,
        name: name || '',
        passwordHash,
        salt,
        createdAt: new Date().toISOString(),
        organisations: orgUrl ? [{ url: orgUrl, name: orgName || orgUrl, addedAt: new Date().toISOString() }] : [],
        previews: previewData ? [{ ...previewData, savedAt: new Date().toISOString() }] : [],
      };
      await redisSet(`user:${emailKey}`, JSON.stringify(user));
      await redisSet(`session:${token}`, emailKey, THIRTY_DAYS);
      return res.status(200).json({ token, user: safeUser(user) });
    } catch (e) {
      console.error('register error', e.message);
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // ── Login ──
  if (action === 'login') {
    const { email, password } = body;
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
    const emailKey = email.toLowerCase().trim();
    try {
      const json = await redisGet(`user:${emailKey}`);
      if (!json) return res.status(401).json({ error: 'invalid_credentials' });
      const user = JSON.parse(json);
      if (hashPassword(password, user.salt) !== user.passwordHash) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      const token = generateToken();
      await redisSet(`session:${token}`, emailKey, THIRTY_DAYS);
      return res.status(200).json({ token, user: safeUser(user) });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // ── Add organisation URL ──
  if (action === 'add_org') {
    const { orgUrl, orgName } = body;
    if (!orgUrl) return res.status(400).json({ error: 'url_required' });
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      if (user.organisations.some(o => o.url === orgUrl)) {
        return res.status(409).json({ error: 'url_already_added' });
      }
      if (user.organisations.length >= 5) {
        return res.status(409).json({ error: 'website_limit_reached' });
      }
      user.organisations.push({ url: orgUrl, name: orgName || orgUrl, addedAt: new Date().toISOString() });
      await redisSet(`user:${user.email}`, JSON.stringify(user));
      return res.status(200).json({ user: safeUser(user) });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // ── Save preview ──
  if (action === 'save_preview') {
    const { previewData } = body;
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      user.previews = user.previews || [];
      user.previews.unshift({ ...previewData, savedAt: new Date().toISOString() });
      if (user.previews.length > 20) user.previews = user.previews.slice(0, 20);
      await redisSet(`user:${user.email}`, JSON.stringify(user));
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // ── Save report ──
  if (action === 'save_report') {
    const { reportData } = body;
    if (!reportData) return res.status(400).json({ error: 'report_data_required' });
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });

      const runDate = new Date().toISOString();
      const queryResults = reportData.queryResults || [];

      // ── Normalise URL for matching ──
      function normUrl(u) {
        try { return new URL((u || '').startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); }
        catch { return (u || '').toLowerCase().replace(/^www\./, ''); }
      }

      // ── Merge into org's queryBank ──
      const orgUrl = (reportData.business && reportData.business.url) || '';
      if (orgUrl) {
        const normTarget = normUrl(orgUrl);
        const org = (user.organisations || []).find(o => normUrl(o.url) === normTarget);
        if (org) {
          org.queryBank   = org.queryBank   || [];
          org.runHistory  = org.runHistory  || [];

          // Merge each valid query result into the bank
          queryResults.filter(q => !q.error).forEach(q => {
            let entry = org.queryBank.find(e => e.question === q.question);
            if (!entry) {
              entry = { question: q.question, promptType: q.promptType || 'general', results: [] };
              org.queryBank.push(entry);
            }
            entry.results.push({
              runDate,
              businessMentioned: !!q.businessMentioned,
              quality: q.quality || null,
              competitors: (q.recommendations || []).map(r => r.name).filter(Boolean).slice(0, 6),
            });
            // Cap per-question history at 24 runs
            if (entry.results.length > 24) entry.results = entry.results.slice(-24);
          });

          // Cap total unique questions in bank (most recently tested first)
          if (org.queryBank.length > 80) {
            org.queryBank.sort((a, b) => {
              const lA = a.results[a.results.length - 1]?.runDate || '';
              const lB = b.results[b.results.length - 1]?.runDate || '';
              return lB.localeCompare(lA);
            });
            org.queryBank = org.queryBank.slice(0, 80);
          }

          // Record this run in history (for trend sparkline)
          org.runHistory.push({
            runDate,
            score:   reportData.visibilityScore || 0,
            totalQ:  queryResults.filter(q => !q.error).length,
            mentions: reportData.mentionCount || 0,
          });
          if (org.runHistory.length > 24) org.runHistory = org.runHistory.slice(-24);

          // Cache latest report metadata on the org
          org.business         = reportData.business         || org.business;
          org.lastRunAt        = runDate;
          org.visibilityGaps   = (reportData.visibilityGaps   || []).slice(0, 10);
          org.recommendations  = (reportData.recommendations  || []).slice(0, 5);
          org.riskNarrative    = reportData.riskNarrative    || null;
        }
      }

      // ── Also keep a trimmed individual report (for "view report" detail, backwards compat) ──
      user.reports = user.reports || [];
      const trimmed = {
        ...reportData,
        savedAt: runDate,
        queryResults: queryResults.map(q => ({
          question:          q.question,
          promptType:        q.promptType,
          businessMentioned: q.businessMentioned,
          quality:           q.quality,
          recCount:          q.recCount,
          error:             q.error || false,
          recommendations:   (q.recommendations || []).slice(0, 5),
        })),
      };
      user.reports.unshift(trimmed);
      if (user.reports.length > 5) user.reports = user.reports.slice(0, 5);

      await redisSet(`user:${user.email}`, JSON.stringify(user));
      return res.status(200).json({ ok: true, user: safeUser(user) });
    } catch (e) {
      console.error('save_report error', e.message);
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // ── Delete organisation ──
  if (action === 'delete_org') {
    const { orgUrl } = body;
    if (!orgUrl) return res.status(400).json({ error: 'url_required' });
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      user.organisations = (user.organisations || []).filter(o => o.url !== orgUrl);
      await redisSet(`user:${user.email}`, JSON.stringify(user));
      return res.status(200).json({ ok: true, user: safeUser(user) });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // ── Logout ──
  if (action === 'logout') {
    const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (auth) await redisDel(`session:${auth}`).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown_action' });
};
