const https = require('https');
const { URL } = require('url');

function postJson(url, payload, timeout, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL')); }
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function readBody(req) {
  return new Promise(resolve => {
    if (req.body) return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

function parseRecsJson(text, businessName) {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON object found');
  const parsed = JSON.parse(match[0]);
  const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const bizLower = (businessName || '').toLowerCase();
  const mentioned = bizLower.length > 2 && recs.some(r =>
    (r.name || '').toLowerCase().includes(bizLower) ||
    bizLower.includes((r.name || '').toLowerCase().replace(/\s+/g, ' ').trim())
  );
  return { intro: parsed.intro || '', recommendations: recs, recommendationCount: recs.length, businessMentioned: mentioned };
}

async function tryOpenAI(url, model, prompt, apiKey, extraHeaders, timeout) {
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful AI recommendation assistant. Return only valid JSON — no markdown, no code fences.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 400,
  };
  return postJson(url, payload, timeout, { Authorization: `Bearer ${apiKey}`, ...extraHeaders });
}

async function tryGemini(model, prompt, apiKey) {
  const payload = {
    contents: [{ parts: [{ text: prompt + '\n\nReturn ONLY the JSON object. No markdown.' }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
  };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return postJson(endpoint, payload, 12000);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);
  const { question, businessName, promptType, searchIntent } = body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  const OR_KEY   = process.env.OPENROUTER_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GROQ_KEY && !OR_KEY && !GEMINI_KEY) {
    return res.status(503).json({ error: 'no_ai_provider' });
  }

  // ── Brand audit mode ─────────────────────────────────────────────────────────
  if (promptType === 'brand_audit') {
    const intentGuide = {
      'brand recognition':     'Focus only on: what the brand is, when it was founded, what makes it distinctive. Do NOT describe products in detail.',
      'product knowledge':     'Focus only on: specific named products, SKUs, flavours, or product lines. List as many specific products as you know. Do NOT give a general brand description.',
      'availability':          'Focus only on: specific stockists, retailers, online channels, countries where available. Name specific stores. Do NOT describe the products.',
      'comparison positioning':'Focus only on: how this brand compares to rivals — price positioning, quality, ingredients, target audience. Name specific competitors and concrete differences.',
      'retail availability':   'Focus only on: specific UK supermarket chains that stock this brand, and whether it is nationwide or regional. Name the stores.',
    }[searchIntent] || 'Answer only what was asked. Do not repeat the brand description.';

    const auditPrompt = `You are being asked to audit what you know about a specific brand. Answer ONLY what is asked — do not open with "X is a company that makes..." as that is repetitive across questions.

Question: "${question}"
Focus: ${intentGuide}

Be specific and factual. Use real names (products, stores, etc.). If you genuinely don't know, say so briefly.

Return ONLY valid JSON:
{
  "recognised": true or false,
  "response": "2-4 sentences focused specifically on what was asked — no generic brand intro",
  "products_mentioned": ["specific named products if relevant, else empty array"],
  "channels_mentioned": ["specific retailers/channels if relevant, else empty array"],
  "confidence": "high or medium or low or unknown"
}`;

    async function auditAttempt(fn) {
      try {
        const result = await fn();
        if (result.status === 200) {
          const text = result.body?.choices?.[0]?.message?.content || result.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (!match) return null;
          return JSON.parse(match[0]);
        }
        return null;
      } catch { return null; }
    }

    // Run Groq + OpenRouter in parallel for audit
    const auditCandidates = [];
    if (GROQ_KEY) auditCandidates.push(
      auditAttempt(() => tryOpenAI('https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile', auditPrompt, GROQ_KEY, {}, 12000))
    );
    if (OR_KEY) auditCandidates.push(
      auditAttempt(() => tryOpenAI('https://openrouter.ai/api/v1/chat/completions', 'meta-llama/llama-3.3-70b-instruct:free', auditPrompt, OR_KEY,
        { 'HTTP-Referer': 'https://visible.ai', 'X-Title': 'Visible AI' }, 12000))
    );

    const auditResults = await Promise.allSettled(auditCandidates);
    for (const r of auditResults) {
      if (r.status === 'fulfilled' && r.value) {
        return res.status(200).json({ ...r.value, isBrandAudit: true });
      }
    }
    return res.status(200).json({ recognised: false, response: '', products_mentioned: [], channels_mentioned: [], confidence: 'unknown', isBrandAudit: true });
  }

  // ── Discovery / comparison / occasion query ──────────────────────────────────
  const prompt = `A real person typed this into an AI assistant: "${question}"

You are that AI assistant responding with genuine brand recommendations. Name 4-5 real, specific brands or businesses that actually exist and are relevant to this query. Be concrete — name actual brands, products, or services.

Return ONLY valid JSON:
{"intro":"one sentence summarising what you'd recommend and why","recommendations":[{"name":"Real Brand Name","reason":"one specific sentence about why this brand fits the query"}]}

Important: Only name brands you are confident actually exist and are relevant. Do not make up brand names.`;

  function extractText(result, provider) {
    if (provider === 'gemini') return result.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return result.body?.choices?.[0]?.message?.content || '';
  }

  async function attempt(fn, provider) {
    try {
      const result = await fn();
      if (result.status === 429 || result.status === 503) return { rateLimited: true };
      if (result.status === 200) {
        const text = extractText(result, provider);
        try { return { ok: true, data: parseRecsJson(text, businessName) }; }
        catch { return { parseError: true }; }
      }
      console.error(provider, 'error', result.status, JSON.stringify(result.body).slice(0, 150));
      return { failed: true };
    } catch (err) {
      console.error(provider, 'threw:', err.message);
      return { failed: true };
    }
  }

  // Run all available providers in parallel — first valid response wins
  const candidates = [];
  if (GROQ_KEY) candidates.push(
    attempt(() => tryOpenAI('https://api.groq.com/openai/v1/chat/completions', 'llama-3.1-8b-instant', prompt, GROQ_KEY, {}, 10000), 'groq')
  );
  if (OR_KEY) candidates.push(
    attempt(() => tryOpenAI('https://openrouter.ai/api/v1/chat/completions', 'meta-llama/llama-3.3-70b-instruct:free', prompt, OR_KEY,
      { 'HTTP-Referer': 'https://visible.ai', 'X-Title': 'Visible AI' }, 12000), 'openrouter')
  );
  if (GEMINI_KEY) candidates.push(
    attempt(() => tryGemini('gemini-2.0-flash', prompt, GEMINI_KEY), 'gemini')
  );

  const settled = await Promise.allSettled(candidates);
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.ok) {
      return res.status(200).json({ ...r.value.data, businessName: businessName || '' });
    }
  }

  return res.status(503).json({ error: 'All AI providers failed' });
};
