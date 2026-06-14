const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── HTTP fetch ────────────────────────────────────────────────────────────────

function fetchHtml(rawUrl, timeout = 9000, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error('Invalid URL')); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || undefined,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VisibilityCheck/1.0; +https://visible.app)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
    }, (res) => {
      // Follow one redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, rawUrl).href;
        res.destroy();
        return fetchHtml(next, timeout, redirectsLeft - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { if (data.length < 300_000) data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ── HTML extraction ───────────────────────────────────────────────────────────

function extract(html) {
  const titleM = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : '';

  const metaM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{1,400})["'][^>]+name=["']description["']/i);
  const metaDesc = metaM ? metaM[1].replace(/\s+/g, ' ').trim() : '';

  const headings = [];
  const hRe = /<h[1-3][^>]*>([\s\S]{1,200}?)<\/h[1-3]>/gi;
  let m;
  while ((m = hRe.exec(html)) && headings.length < 10) {
    const t = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (t.length > 2 && t.length < 150) headings.push(t);
  }

  const bodyText = html
    .replace(/<(script|style|nav|footer|header|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);

  return { title, metaDesc, headings, bodyText };
}

// ── Category detection ────────────────────────────────────────────────────────

const CATEGORIES = {
  skincare: ['serum', 'moisturiser', 'moisturizer', 'cleanser', 'spf', 'retinol', 'vitamin c', 'skincare', 'skin care', 'acne', 'anti-aging', 'anti-ageing', 'sunscreen', 'toner', 'exfoliant', 'exfoliator', 'hyaluronic', 'niacinamide', 'face wash', 'eye cream', 'face oil', 'pore'],
  haircare: ['shampoo', 'conditioner', 'hair mask', 'hair oil', 'hair care', 'haircare', 'scalp', 'hair growth', 'argan', 'keratin', 'hair serum', 'split ends'],
  supplements: ['supplement', 'vitamin', 'collagen', 'protein powder', 'omega', 'probiotic', 'prebiotic', 'gut health', 'capsule', 'gummy', 'biotin', 'magnesium', 'zinc'],
  makeup: ['foundation', 'lipstick', 'mascara', 'eyeshadow', 'blush', 'concealer', 'primer', 'makeup', 'cosmetics', 'contour', 'highlighter', 'bronzer'],
  bodycare: ['body lotion', 'body wash', 'body scrub', 'deodorant', 'body butter', 'body cream', 'bath', 'body care'],
  fragrance: ['perfume', 'fragrance', 'eau de parfum', 'eau de toilette', 'scent', 'cologne', 'diffuser', 'candle'],
  wellness: ['wellness', 'holistic', 'sleep', 'stress', 'adaptogen', 'cbd', 'nootropic', 'functional', 'ayurvedic'],
};

function detectCategory(text) {
  const lower = text.toLowerCase();
  let best = { category: 'beauty', score: 0 };
  for (const [cat, keywords] of Object.entries(CATEGORIES)) {
    const score = keywords.filter(k => lower.includes(k)).length;
    if (score > best.score) best = { category: cat, score };
  }
  return best.category;
}

// ── Question templates ────────────────────────────────────────────────────────

const QUESTIONS = {
  skincare: [
    'best vitamin C serum for sensitive skin',
    'best moisturiser for dry skin under £30',
    'best cruelty-free retinol serum',
    'best SPF moisturiser for daily use',
    'skincare routine for acne-prone skin',
  ],
  haircare: [
    'best shampoo for damaged hair',
    'best conditioner for frizzy hair',
    'best hair growth serum',
    'best shampoo for colour-treated hair',
  ],
  supplements: [
    'best collagen supplement for skin',
    'best vitamin D supplement',
    'best probiotic for gut health',
    'best magnesium supplement for sleep',
  ],
  makeup: [
    'best foundation for dry skin',
    'best cruelty-free mascara',
    'long-lasting lipstick under £20',
    'best concealer for dark circles',
  ],
  bodycare: [
    'best body lotion for dry skin',
    'best natural deodorant',
    'best body scrub for smooth skin',
    'best body butter for eczema',
  ],
  fragrance: [
    'best floral perfume for women',
    'best long-lasting fragrance under £50',
    'best unisex perfume 2025',
    'best fresh summer fragrance',
  ],
  wellness: [
    'best sleep supplement',
    'best stress relief supplement',
    'best adaptogen for energy',
    'best supplement for anxiety',
  ],
  beauty: [
    'best beauty products for sensitive skin',
    'best cruelty-free beauty brands',
    'affordable luxury beauty products',
    'best clean beauty skincare routine',
  ],
};

const CUSTOMER_TYPES = {
  skincare: 'skincare shoppers researching ingredients and results',
  haircare: 'haircare shoppers looking for targeted solutions',
  supplements: 'health-conscious consumers comparing ingredients and efficacy',
  makeup: 'makeup shoppers researching coverage, finish and ethics',
  bodycare: 'body care shoppers looking for targeted skin solutions',
  fragrance: 'fragrance shoppers comparing scent profiles and longevity',
  wellness: 'wellness-focused consumers researching evidence-backed products',
  beauty: 'beauty shoppers researching brand reputation and ingredients',
};

// ── Summary builder ───────────────────────────────────────────────────────────

function buildSummary(title, metaDesc, headings) {
  if (metaDesc && metaDesc.length > 40) return metaDesc.slice(0, 200);
  if (headings.length > 0) return `${title ? title + ' — ' : ''}${headings[0]}`.slice(0, 200);
  if (title) return title.slice(0, 200);
  return 'Website content extracted — category detected from public page signals.';
}

function buildRiskNarrative(brandName, category) {
  const name = brandName || 'your brand';
  const cat = category === 'beauty' ? 'beauty and skincare' : category;
  return `When shoppers ask AI assistants for ${cat} recommendations, they typically receive 3–5 brand names in response. Based on ${name}'s public website signals, we've identified the question types where visibility gaps are most likely. The full report shows which specific queries your brand is missing from, and which brands are appearing instead.`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);
  let { url: targetUrl, brandName = '', market = 'UK' } = body;

  if (!targetUrl) return res.status(400).json({ error: 'url is required' });
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  let title = '', metaDesc = '', headings = [], bodyText = '', fetchedOk = false;

  try {
    const html = await fetchHtml(targetUrl);
    const extracted = extract(html);
    ({ title, metaDesc, headings, bodyText } = extracted);
    fetchedOk = true;
  } catch {
    // Graceful degradation — still return a useful result
  }

  const allText = [title, metaDesc, ...headings, bodyText].join(' ');
  const category = detectCategory(allText);
  const questions = (QUESTIONS[category] || QUESTIONS.beauty).slice(0, 4);
  const summary = buildSummary(title, metaDesc, headings);
  const customerType = CUSTOMER_TYPES[category] || CUSTOMER_TYPES.beauty;
  const riskNarrative = buildRiskNarrative(brandName || title, category);

  res.status(200).json({
    fetchedOk,
    title,
    metaDescription: metaDesc,
    headings: headings.slice(0, 5),
    category,
    summary,
    customerType,
    questions,
    riskNarrative,
  });
};
