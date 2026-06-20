// Competitor enrichment — sequential DDG lookups to find URL + description for each competitor
// Called after the main analysis completes; results enrich the competitor section in the report.

const https = require('https');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readBody(req) {
  return new Promise(resolve => {
    if (req.body) return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

function fetchDDGInstant(query) {
  return new Promise((resolve) => {
    const q = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
    setTimeout(() => resolve(null), 5000);
  });
}

function extractCompetitorInfo(ddg, name) {
  if (!ddg) return {};

  // Homepage URL — DDG puts the official site in Results[0].FirstURL (Text = "Official site")
  let url = null;
  const results = Array.isArray(ddg.Results) ? ddg.Results : [];
  const officialResult = results.find(r => /official/i.test(r.Text || ''));
  if (officialResult?.FirstURL) url = officialResult.FirstURL;
  // Fallback: AbstractURL is the Wikipedia page — not the brand homepage, skip it

  // Description from DDG abstract
  const description = (ddg.AbstractText || '').trim() || null;

  // Location — infer from RelatedTopics category text (e.g. "Pizza chains of the United Kingdom")
  let location = null;
  const topics = Array.isArray(ddg.RelatedTopics) ? ddg.RelatedTopics : [];
  const countryPatterns = [
    [/united kingdom|uk\b/i, 'UK'],
    [/united states|usa\b/i, 'USA'],
    [/australia\b/i, 'Australia'],
    [/canada\b/i, 'Canada'],
    [/ireland\b/i, 'Ireland'],
    [/germany\b/i, 'Germany'],
    [/france\b/i, 'France'],
    [/new zealand\b/i, 'New Zealand'],
    [/india\b/i, 'India'],
  ];
  for (const t of topics) {
    const text = t.Text || '';
    for (const [pattern, label] of countryPatterns) {
      if (pattern.test(text)) { location = label; break; }
    }
    if (location) break;
  }

  return { url, description, location };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await readBody(req);
  const { competitors = [], market = null } = body;

  if (!Array.isArray(competitors) || competitors.length === 0) {
    return res.status(400).json({ error: 'competitors array required' });
  }

  // Cap at 5 to keep latency reasonable
  const toEnrich = competitors.slice(0, 5);
  const results = [];

  for (let i = 0; i < toEnrich.length; i++) {
    const comp = toEnrich[i];
    const name = comp.name || '';
    if (!name) { results.push({ ...comp }); continue; }

    // Query: "BrandName brand" — helps DDG return the entity, not a generic page
    const query = market ? `${name} ${market}` : `${name} brand`;
    const ddg = await fetchDDGInstant(query);
    const enriched = extractCompetitorInfo(ddg, name);

    results.push({
      name,
      count: comp.count,
      credibility: comp.credibility,
      promptTypes: comp.promptTypes,
      ...enriched,
    });

    console.log(`Competitor enriched: ${name} → url=${enriched.url || 'none'} loc=${enriched.location || 'none'}`);

    // Gap between requests to avoid rate limits (skip after last)
    if (i < toEnrich.length - 1) await sleep(800);
  }

  return res.status(200).json({ competitors: results });
};
