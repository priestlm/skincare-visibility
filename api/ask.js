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
  // Find JSON object in the text
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);
  const { question, businessName } = body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'no_ai_provider' });
  }

  const prompt = `A person asked an AI assistant: "${question}"

You are that AI assistant. Give a helpful, specific answer listing 4-5 real brand or business recommendations that genuinely answer this query. Be specific — name actual brands or businesses, not generic descriptions.

Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "intro": "one sentence acknowledging the query",
  "recommendations": [
    { "name": "Specific Brand or Business Name", "reason": "one sentence why it is a good fit for this query" }
  ]
}`;

  // Try OpenRouter with multiple free models
  if (process.env.OPENROUTER_API_KEY) {
    const OR_MODELS = [
      'meta-llama/llama-3.1-8b-instruct:free',
      'google/gemma-3-12b-it:free',
      'mistralai/mistral-7b-instruct:free',
    ];
    for (const model of OR_MODELS) {
      try {
        const payload = {
          model,
          messages: [
            { role: 'system', content: 'You are a helpful AI shopping and recommendation assistant. Return only valid JSON — no markdown, no code fences.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          max_tokens: 800,
        };
        const result = await postJson(
          'https://openrouter.ai/api/v1/chat/completions',
          payload,
          10000,
          {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://visible.ai',
            'X-Title': 'Visible AI Visibility',
          },
        );
        if (result.status === 429 || result.status === 503) {
          console.log('OpenRouter', model, 'rate-limited/unavailable, trying next model');
          continue;
        }
        if (result.status === 200) {
          const text = result.body?.choices?.[0]?.message?.content || '';
          try {
            const parsed = parseRecsJson(text, businessName);
            return res.status(200).json({ ...parsed, businessName: businessName || '' });
          } catch (parseErr) {
            console.error('OpenRouter', model, 'parse error:', parseErr.message, 'text:', text.slice(0, 200));
            continue;
          }
        }
        console.error('OpenRouter', model, 'error', result.status, JSON.stringify(result.body).slice(0, 200));
      } catch (err) {
        console.error('OpenRouter', model, 'failed:', err.message);
      }
    }
  }

  // Gemini fallback — use flash-lite for speed, flash as backup
  if (process.env.GEMINI_API_KEY) {
    const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];
    for (const model of GEMINI_MODELS) {
      try {
        const geminiPrompt = prompt + '\n\nIMPORTANT: Return ONLY the JSON object. No markdown. No code fences.';
        const payload = {
          contents: [{ parts: [{ text: geminiPrompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
        };
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const result = await postJson(endpoint, payload, 12000);
        if (result.status === 429) { console.log('Gemini', model, 'rate-limited, trying next'); continue; }
        if (result.status === 200) {
          const text = result.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          try {
            const parsed = parseRecsJson(text, businessName);
            return res.status(200).json({ ...parsed, businessName: businessName || '' });
          } catch (parseErr) {
            console.error('Gemini', model, 'parse error:', parseErr.message);
            continue;
          }
        }
        console.error('Gemini', model, 'error', result.status);
      } catch (err) {
        console.error('Gemini', model, 'failed:', err.message);
      }
    }
  }

  return res.status(503).json({ error: 'All AI providers failed' });
};
