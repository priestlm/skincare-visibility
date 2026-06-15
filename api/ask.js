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

// Try a single OpenAI-compatible endpoint (Groq or OpenRouter)
async function tryOpenAI(url, model, prompt, apiKey, extraHeaders, timeout) {
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful AI recommendation assistant. Return only valid JSON — no markdown, no code fences.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 350,
  };
  return postJson(url, payload, timeout, { Authorization: `Bearer ${apiKey}`, ...extraHeaders });
}

async function tryGemini(model, prompt, apiKey) {
  const payload = {
    contents: [{ parts: [{ text: prompt + '\n\nReturn ONLY the JSON object. No markdown.' }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
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
  const { question, businessName } = body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  if (!hasGroq && !hasGemini && !hasOpenRouter) {
    return res.status(503).json({ error: 'no_ai_provider' });
  }

  const prompt = `A person asked an AI assistant: "${question}"

You are that AI assistant. List 4-5 real brand or business recommendations. Be specific — name actual brands, not generic descriptions.

Return ONLY valid JSON:
{"intro":"one sentence","recommendations":[{"name":"Brand Name","reason":"one sentence why"}]}`;

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

  // 1. Groq — fastest, generous free rate limits
  if (hasGroq) {
    const r = await attempt(
      () => tryOpenAI('https://api.groq.com/openai/v1/chat/completions', 'llama-3.1-8b-instant', prompt, process.env.GROQ_API_KEY, {}, 8000),
      'groq'
    );
    if (r.ok) return res.status(200).json({ ...r.data, businessName: businessName || '' });
    if (r.rateLimited) console.log('Groq rate-limited, trying Gemini');
  }

  // 2. Gemini flash-lite then flash
  if (hasGemini) {
    for (const model of ['gemini-2.0-flash-lite', 'gemini-2.0-flash']) {
      const r = await attempt(() => tryGemini(model, prompt, process.env.GEMINI_API_KEY), 'gemini-' + model);
      if (r.ok) return res.status(200).json({ ...r.data, businessName: businessName || '' });
      if (r.rateLimited) { console.log('Gemini', model, 'rate-limited, trying next'); continue; }
      if (r.failed) break;
    }
  }

  // 3. OpenRouter free models as last resort
  if (hasOpenRouter) {
    for (const model of ['meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free']) {
      const r = await attempt(
        () => tryOpenAI('https://openrouter.ai/api/v1/chat/completions', model, prompt, process.env.OPENROUTER_API_KEY,
          { 'HTTP-Referer': 'https://visible.ai', 'X-Title': 'Visible AI' }, 10000),
        'openrouter-' + model
      );
      if (r.ok) return res.status(200).json({ ...r.data, businessName: businessName || '' });
      if (r.rateLimited) continue;
    }
  }

  return res.status(503).json({ error: 'All AI providers failed' });
};
