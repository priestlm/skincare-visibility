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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);
  const { question, businessName } = body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'no_ai_provider' });
  }

  const prompt = `A person asked an AI assistant: "${question}"

You are that AI assistant. Give a helpful, specific answer listing 4-5 real brand or business recommendations that genuinely answer this query. Be specific — name actual brands or businesses, not generic descriptions.

Return ONLY valid JSON in this exact format (no markdown, no fences):
{
  "intro": "one sentence acknowledging the query",
  "recommendations": [
    { "name": "Specific Brand or Business Name", "reason": "one sentence why it is a good fit for this query" }
  ]
}`;

  // Try OpenRouter first
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const payload = {
        model: 'openai/gpt-oss-20b:free',
        messages: [
          { role: 'system', content: 'You are a helpful AI shopping and recommendation assistant. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 1000,
      };
      const result = await postJson(
        'https://openrouter.ai/api/v1/chat/completions',
        payload,
        20000,
        { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      );
      if (result.status === 200) {
        const text = result.body?.choices?.[0]?.message?.content || '';
        const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
        const bizLower = (businessName || '').toLowerCase();
        const mentioned = bizLower.length > 2 && recs.some(r =>
          (r.name || '').toLowerCase().includes(bizLower) ||
          bizLower.includes((r.name || '').toLowerCase().replace(/\s+/g, ' ').trim())
        );
        return res.status(200).json({
          intro: parsed.intro || '',
          recommendations: recs,
          businessMentioned: mentioned,
          businessName: businessName || '',
        });
      }
      console.error('OpenRouter ask error', result.status, JSON.stringify(result.body).slice(0, 200));
    } catch (err) {
      console.error('OpenRouter ask failed:', err.message);
    }
  }

  // Gemini fallback
  if (process.env.GEMINI_API_KEY) {
    try {
      const geminiPrompt = prompt + '\n\nIMPORTANT: Return ONLY the JSON object. No markdown.';
      const payload = {
        contents: [{ parts: [{ text: geminiPrompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1000 },
      };
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const result = await postJson(endpoint, payload, 15000);
      if (result.status === 200) {
        const text = result.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
        const bizLower = (businessName || '').toLowerCase();
        const mentioned = bizLower.length > 2 && recs.some(r =>
          (r.name || '').toLowerCase().includes(bizLower) ||
          bizLower.includes((r.name || '').toLowerCase().replace(/\s+/g, ' ').trim())
        );
        return res.status(200).json({
          intro: parsed.intro || '',
          recommendations: recs,
          businessMentioned: mentioned,
          businessName: businessName || '',
        });
      }
    } catch (err) {
      console.error('Gemini ask failed:', err.message);
    }
  }

  return res.status(503).json({ error: 'All AI providers failed' });
};
