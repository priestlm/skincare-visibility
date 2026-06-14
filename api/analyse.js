const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── Future enhancement note ────────────────────────────────────────────────────
// The next version of this function may call an AI API (e.g. Claude via Anthropic SDK)
// using a secure Vercel environment variable (process.env.ANTHROPIC_API_KEY) to generate
// richer summaries and more accurate category classification from scraped content.
// No paid API call is made in this version — classification is keyword-based only.
// ──────────────────────────────────────────────────────────────────────────────

// ── Blocked/error page detection ─────────────────────────────────────────────
// Phrases that indicate the response is a bot-block or error page, not real content.
const BLOCKED_SIGNALS = [
  'access denied', 'forbidden', '403 forbidden', 'request blocked',
  'bot protection', 'just a moment', 'checking your browser',
  'enable javascript and cookies', 'ddos protection', 'akamai',
  'ray id', 'cf-ray', 'attention required', 'security check',
  'please enable cookies', 'are you human',
];

// Titles that are definitively error pages regardless of body
const BLOCKED_TITLES = [
  'access denied', 'forbidden', '403', 'error', 'blocked', 'just a moment',
  'attention required', 'bot check', 'security check',
];

function isBlockedPage(extracted) {
  const { title, bodyText } = extracted;
  const titleLower = (title || '').toLowerCase();
  const bodyLower = (bodyText || '').toLowerCase().slice(0, 2000);

  // Title is a known error title
  if (BLOCKED_TITLES.some(t => titleLower === t || titleLower.startsWith(t + ' '))) return true;

  // Body has a blocked signal and the content is thin (< 500 meaningful chars)
  const bodyMeaningful = bodyText.replace(/\s+/g, ' ').trim().length;
  if (bodyMeaningful < 500 && BLOCKED_SIGNALS.some(s => bodyLower.includes(s))) return true;

  // Body text is nearly empty even though we fetched something
  if (bodyMeaningful < 100) return true;

  return false;
}

// ── Known-domain overrides ────────────────────────────────────────────────────
// Domain overrides fire regardless of whether scraping succeeds or fails.
// Add domains here to guarantee correct classification for major known retailers.
const DOMAIN_OVERRIDES = {
  'sainsburys.co.uk': {
    primary: 'grocery',
    categories: ['grocery', 'food', 'general-retail'],
    summary: 'Sainsbury\'s is one of the UK\'s largest supermarket chains offering grocery delivery, click & collect, fresh food, and own-brand products online and in-store.',
  },
  'tesco.com': {
    primary: 'grocery',
    categories: ['grocery', 'food', 'general-retail'],
    summary: 'Tesco is the UK\'s largest supermarket, offering online grocery delivery, click & collect, Clubcard loyalty, and a wide range of fresh and own-brand products.',
  },
  'waitrose.com': {
    primary: 'grocery',
    categories: ['grocery', 'food'],
    summary: 'Waitrose is a premium UK supermarket known for fresh, high-quality food, own-brand products, and online grocery delivery.',
  },
  'ocado.com': {
    primary: 'grocery',
    categories: ['grocery', 'food'],
    summary: 'Ocado is a UK online-only supermarket offering grocery delivery from a wide range of brands including Waitrose, M&S, and own-label products.',
  },
  'marksandspencer.com': {
    primary: 'fashion',
    categories: ['fashion', 'food', 'homeware', 'general-retail'],
    summary: 'Marks & Spencer is a leading UK retailer selling clothing, lingerie, homeware, and premium food products online and in-store.',
  },
  'next.co.uk': {
    primary: 'fashion',
    categories: ['fashion', 'homeware', 'baby-kids', 'general-retail'],
    summary: 'Next is a UK fashion, homeware, kidswear and general retail brand — one of the UK\'s largest retailers selling clothing, footwear, accessories, furniture and home goods online and in-store.',
  },
  'theordinary.com': {
    primary: 'beauty',
    categories: ['beauty'],
    summary: 'The Ordinary is a skincare brand offering clinical, evidence-based formulations at accessible prices, including serums, acids and moisturisers.',
  },
  'petsathome.com': {
    primary: 'pets',
    categories: ['pets'],
    summary: 'Pets at Home is the UK\'s largest pet care retailer, selling food, accessories and providing vet services and grooming.',
  },
  'hollandandbarrett.com': {
    primary: 'supplements',
    categories: ['supplements', 'food'],
    summary: 'Holland & Barrett is a UK health and wellness retailer specialising in vitamins, supplements, natural health products and health foods.',
  },
  'johnlewis.com': {
    primary: 'homeware',
    categories: ['homeware', 'fashion', 'electronics', 'general-retail'],
    summary: 'John Lewis is a UK department store and online retailer selling homeware, electricals, fashion, nursery and gifting products.',
  },
};

// ── Category definitions with weighted keywords ────────────────────────────────
const CATEGORY_DEFS = {
  grocery: {
    label: 'Grocery & supermarket',
    keywords: [
      'grocery', 'supermarket', 'groceries', 'fresh food', 'food delivery', 'online shopping',
      'click and collect', 'click & collect', 'own brand', 'meal deal', 'fresh produce',
      'fruit and veg', 'bakery', 'dairy', 'meat', 'fish', 'deli', 'chilled', 'frozen',
      'household essentials', 'clubcard', 'nectar', 'loyalty card', 'delivery pass',
      'weekly shop', 'food bank', 'recipe ideas',
    ],
  },
  fashion: {
    label: 'Fashion & apparel',
    keywords: [
      'clothing', 'clothes', 'dress', 'dresses', 'shirt', 'shirts', 'trousers', 'jeans',
      'jacket', 'coat', 'knitwear', 'jumper', 'hoodie', 'sweater', 'trainers', 'shoes',
      'boots', 'heels', 'sandals', 'handbag', 'bag', 'fashion', 'apparel', 'womenswear',
      'menswear', 'outfit', 'wardrobe', 'size guide', 'new in', 'collection', 'swimwear',
      'lingerie', 'underwear', 'socks', 'hat', 'scarf', 'gloves', 'jewellery', 'jewelry',
      'watch', 'belt', 'denim', 'blazer', 'skirt', 'shorts', 'vest',
    ],
  },
  beauty: {
    label: 'Beauty & skincare',
    keywords: [
      'skincare', 'skin care', 'serum', 'moisturiser', 'moisturizer', 'cleanser', 'spf',
      'sunscreen', 'retinol', 'niacinamide', 'hyaluronic', 'vitamin c', 'exfoliant', 'toner',
      'face wash', 'eye cream', 'foundation', 'mascara', 'lipstick', 'lip gloss', 'blush',
      'concealer', 'primer', 'eyeshadow', 'makeup', 'cosmetics', 'beauty', 'hair care',
      'shampoo', 'conditioner', 'hair mask', 'body lotion', 'body wash', 'fragrance',
      'perfume', 'cruelty-free', 'vegan beauty', 'anti-aging', 'anti-ageing', 'acne',
      'complexion', 'pore', 'brightening',
    ],
  },
  homeware: {
    label: 'Homeware & décor',
    keywords: [
      'homeware', 'home decor', 'home décor', 'furniture', 'sofa', 'bed', 'bedding',
      'duvet', 'cushion', 'curtains', 'rug', 'lamp', 'lighting', 'dining', 'kitchen',
      'cookware', 'tableware', 'storage', 'shelving', 'interior', 'living room', 'bedroom',
      'bathroom', 'garden furniture', 'candle', 'wall art', 'picture frame', 'mirror',
      'wardrobe', 'chest of drawers', 'desk', 'office chair', 'throw', 'pillow',
      'towel', 'kitchen appliance',
    ],
  },
  food: {
    label: 'Food & drink',
    keywords: [
      'food', 'drink', 'coffee', 'tea', 'chocolate', 'snack', 'organic', 'artisan',
      'brewery', 'wine', 'spirits', 'gin', 'whisky', 'whiskey', 'beer', 'recipe',
      'ingredient', 'pantry', 'sauce', 'seasoning', 'spice', 'meal kit', 'subscription box',
      'vegan food', 'gluten-free', 'dairy-free', 'grocery', 'bakery', 'confectionery',
      'jam', 'honey', 'olive oil', 'pasta', 'cooking',
    ],
  },
  supplements: {
    label: 'Supplements & wellness',
    keywords: [
      'supplement', 'vitamin', 'mineral', 'protein powder', 'collagen', 'omega', 'probiotic',
      'prebiotic', 'gut health', 'immune', 'biotin', 'magnesium', 'zinc', 'cbd', 'adaptogen',
      'nootropic', 'wellness', 'health food', 'natural remedy', 'herbal', 'detox',
      'multivitamin', 'capsule', 'gummy', 'whey', 'creatine', 'weight loss', 'metabolism',
      'energy supplement', 'sleep supplement',
    ],
  },
  pets: {
    label: 'Pet products',
    keywords: [
      'pet', 'dog', 'cat', 'puppy', 'kitten', 'vet', 'grooming', 'pet food', 'dog food',
      'cat food', 'wet food', 'dry food', 'pet accessories', 'collar', 'lead', 'leash',
      'harness', 'pet bed', 'aquarium', 'fish', 'bird', 'rabbit', 'hamster', 'guinea pig',
      'flea', 'worming', 'pet health', 'kennel', 'litter', 'treats', 'chew',
    ],
  },
  fitness: {
    label: 'Fitness & sports',
    keywords: [
      'fitness', 'gym', 'workout', 'exercise', 'sport', 'sports', 'yoga', 'pilates',
      'running', 'cycling', 'swimming', 'training', 'weights', 'dumbbell', 'barbell',
      'kettlebell', 'activewear', 'leggings', 'sports bra', 'marathon', 'football',
      'rugby', 'tennis', 'golf', 'cricket', 'outdoor', 'hiking', 'climbing', 'crossfit',
      'personal trainer', 'physiotherapy',
    ],
  },
  'baby-kids': {
    label: 'Baby & kids',
    keywords: [
      'baby', 'toddler', 'newborn', 'infant', 'kids', 'children', 'child', 'nursery',
      'pushchair', 'pram', 'buggy', 'stroller', 'car seat', 'toy', 'toys', 'nappy',
      'diapers', 'feeding', 'weaning', 'school uniform', 'kidswear', 'maternity',
      'pregnancy', 'bouncer', 'cot', 'moses basket', 'high chair', 'monitor',
      'nappy bag', 'baby food', 'formula', 'teething',
    ],
  },
  electronics: {
    label: 'Electronics & accessories',
    keywords: [
      'phone', 'smartphone', 'laptop', 'tablet', 'headphones', 'earbuds', 'airpods',
      'speaker', 'camera', 'tech', 'gadget', 'charger', 'cable', 'case', 'screen protector',
      'smartwatch', 'wearable', 'drone', 'gaming', 'console', 'keyboard', 'mouse',
      'monitor', 'printer', 'smart home', 'alexa', 'google home', 'router', 'broadband',
      'memory', 'storage', 'hard drive', 'usb',
    ],
  },
  'professional-services': {
    label: 'Professional services',
    keywords: [
      'agency', 'consultancy', 'consulting', 'accountant', 'solicitor', 'lawyer',
      'recruitment', 'staffing', 'marketing agency', 'design agency', 'software development',
      'it services', 'managed services', 'outsourcing', 'strategy', 'advisory', 'audit',
      'compliance', 'hr services', 'payroll', 'financial planning', 'wealth management',
      'architecture', 'engineering firm',
    ],
  },
  'local-services': {
    label: 'Local services',
    keywords: [
      'plumber', 'electrician', 'builder', 'painter', 'decorator', 'cleaner', 'locksmith',
      'gardener', 'landscaping', 'removal', 'salon', 'barber', 'dentist', 'physio',
      'massage', 'tattoo', 'beauty salon', 'nail', 'restaurant', 'takeaway', 'delivery',
      'near me', 'local', 'estate agent', 'letting agent',
    ],
  },
  'general-retail': {
    label: 'General retail',
    keywords: [
      'department store', 'superstore', 'retail', 'marketplace', 'gift', 'gifts', 'sale',
      'clearance', 'outlet', 'discount', 'offer', 'deals', 'multipack', 'bundle',
      'wide range', 'shop online', 'free delivery', 'returns policy', 'click and collect',
      'next day delivery', 'gift card', 'wishlist', 'order tracking',
    ],
  },
};

// ── Question templates per category ───────────────────────────────────────────
const QUESTIONS = {
  grocery: [
    'best online grocery delivery in the UK',
    'best supermarket for fresh food UK',
    'best supermarket own-brand products UK',
    'best grocery delivery for families UK',
    'best value supermarket in the UK',
  ],
  fashion: [
    'best affordable women\'s jeans UK 2025',
    'best men\'s winter coat under £100',
    'best running trainers for beginners UK',
    'best sustainable fashion brands UK',
  ],
  beauty: [
    'best vitamin C serum for sensitive skin',
    'best moisturiser for dry skin under £30',
    'best cruelty-free retinol serum UK',
    'best SPF moisturiser for daily use',
  ],
  homeware: [
    'best affordable sofa UK under £600',
    'best Egyptian cotton bedding set',
    'best coffee maker for home use UK',
    'best scented candle for living rooms',
  ],
  food: [
    'best specialty coffee subscription UK',
    'best artisan chocolate brand UK',
    'best craft gin UK 2025',
    'best organic pasta sauce UK',
  ],
  supplements: [
    'best collagen supplement for skin UK',
    'best vitamin D supplement UK',
    'best probiotic for gut health UK',
    'best magnesium supplement for sleep',
  ],
  pets: [
    'best dry dog food for sensitive stomachs UK',
    'best cat food for indoor cats',
    'best dog harness for large breeds',
    'best cat tree for small flats',
  ],
  fitness: [
    'best yoga mat for beginners UK',
    'best resistance bands set UK',
    'best running shoes for flat feet',
    'best home gym equipment under £200',
  ],
  'baby-kids': [
    'best lightweight pushchair 2025 UK',
    'best newborn sleeping bag',
    'best educational toys for toddlers',
    'best convertible car seat UK',
  ],
  electronics: [
    'best wireless earbuds under £100 UK',
    'best laptop for students UK 2025',
    'best portable charger UK',
    'best smartwatch under £200',
  ],
  'professional-services': [
    'best small business accountants UK',
    'best digital marketing agency for ecommerce',
    'best IT support for small business UK',
    'best HR software for startups',
  ],
  'local-services': [
    'best hair salon near me highly rated',
    'best local plumber for emergencies',
    'best cleaning service for homes',
    'best dentist for nervous patients',
  ],
  'general-retail': [
    'best UK department store for homeware',
    'best online retailer for next-day delivery UK',
    'best place to buy gifts online UK',
    'best UK retailer for back to school',
  ],
  other: [
    'best products in this category UK',
    'most recommended brands online 2025',
    'top-rated options for shoppers',
    'most visible brands in AI shopping results',
  ],
};

// ── Customer type labels ───────────────────────────────────────────────────────
const CUSTOMER_TYPES = {
  grocery:                 'shoppers researching grocery delivery, supermarket options and food value',
  fashion:                'shoppers researching clothing, footwear and accessories',
  beauty:                  'beauty shoppers researching ingredients and product results',
  homeware:                'home shoppers looking for furniture, bedding and décor',
  food:                    'food lovers exploring artisan and specialty products',
  supplements:             'health-conscious consumers comparing supplements and nutrition',
  pets:                    'pet owners researching food, accessories and health products',
  fitness:                 'fitness enthusiasts looking for equipment and activewear',
  'baby-kids':             'parents researching safe, age-appropriate products for children',
  electronics:             'tech shoppers comparing devices, specs and value',
  'professional-services': 'businesses sourcing specialist professional services',
  'local-services':        'local customers searching for trusted service providers',
  'general-retail':        'shoppers comparing brands and products across multiple categories',
  other:                   'online shoppers researching and comparing products',
};

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
        'User-Agent': 'Mozilla/5.0 (compatible; VisibilityCheck/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, rawUrl).href;
        res.destroy();
        return fetchHtml(next, timeout, redirectsLeft - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { if (data.length < 400_000) data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ── HTML extraction ───────────────────────────────────────────────────────────
function extract(html) {
  const titleM = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : '';

  const metaM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,600})["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{1,600})["'][^>]+name=["']description["']/i);
  const metaDesc = metaM ? metaM[1].replace(/\s+/g, ' ').trim() : '';

  const ogTitleM = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:title["']/i);
  const ogTitle = ogTitleM ? ogTitleM[1].replace(/\s+/g, ' ').trim() : '';

  const ogDescM = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,600})["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{1,600})["'][^>]+property=["']og:description["']/i);
  const ogDesc = ogDescM ? ogDescM[1].replace(/\s+/g, ' ').trim() : '';

  const headings = [];
  const hRe = /<h[1-3][^>]*>([\s\S]{1,300}?)<\/h[1-3]>/gi;
  let m;
  while ((m = hRe.exec(html)) && headings.length < 12) {
    const t = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (t.length > 2 && t.length < 180) headings.push(t);
  }

  // Extract nav/category link text — good category signal
  const navLinks = [];
  const navBlocks = html.match(/<nav[\s\S]{0,8000}?<\/nav>/gi) || [];
  navBlocks.forEach(nav => {
    const linkRe = /<a[^>]*>([^<]{2,50})<\/a>/gi;
    let lm;
    while ((lm = linkRe.exec(nav)) && navLinks.length < 40) {
      const t = lm[1].replace(/\s+/g, ' ').trim();
      if (t.length > 2) navLinks.push(t);
    }
  });

  const bodyText = html
    .replace(/<(script|style|nav|footer|header|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);

  return { title, metaDesc, ogTitle, ogDesc, headings, navLinks, bodyText };
}

// ── Category detection ────────────────────────────────────────────────────────
function detectCategories(extracted) {
  const { title, metaDesc, ogTitle, ogDesc, headings, navLinks, bodyText } = extracted;

  // Higher weight for title/OG (3×), meta/headings/navLinks (2×), body (1×)
  const corpus = [
    title.repeat ? title.repeat(3) : title + title + title,
    ogTitle.repeat ? ogTitle.repeat(3) : '',
    metaDesc.repeat ? metaDesc.repeat(2) : '',
    ogDesc.repeat ? ogDesc.repeat(2) : '',
    (headings.join(' ') + ' ').repeat(2),
    (navLinks.join(' ') + ' ').repeat(2),
    bodyText,
  ].join(' ').toLowerCase();

  const scores = {};
  for (const [key, def] of Object.entries(CATEGORY_DEFS)) {
    scores[key] = def.keywords.filter(k => corpus.includes(k)).length;
  }

  const sorted = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return { primary: 'other', categories: ['other'] };

  const primary = sorted[0][0];
  const maxScore = sorted[0][1];
  const threshold = Math.max(2, maxScore * 0.45);

  const categories = sorted
    .filter(([, s]) => s >= threshold)
    .slice(0, 4)
    .map(([k]) => k);

  if (!categories.includes(primary)) categories.unshift(primary);
  return { primary, categories };
}

// ── Summary builder ───────────────────────────────────────────────────────────
function buildSummary(extracted, brandName) {
  const { title, metaDesc, ogDesc, headings } = extracted;
  const best = ogDesc || metaDesc;
  if (best && best.length > 40) return best.slice(0, 240);
  if (headings.length > 0) return (title ? title + ' — ' : '') + headings[0];
  return title || `Initial analysis based on public website signals${brandName ? ' for ' + brandName : ''}.`;
}

function buildRiskNarrative(brandName, primary, categories) {
  const name = brandName || 'your brand';
  const catLabel = CATEGORY_DEFS[primary]?.label || primary;
  const others = categories.filter(c => c !== primary).map(c => CATEGORY_DEFS[c]?.label || c);
  const multi = others.length > 0 ? ` (and ${others.join(', ')})` : '';
  return `When shoppers ask AI assistants for ${catLabel}${multi} recommendations, they typically receive 3–5 brand names. Based on ${name}'s public website signals, we've identified the question types where visibility gaps are most likely. The full report shows which queries are relevant to your brand and which competitors are appearing instead.`;
}

function buildQuestions(categories) {
  const seen = new Set();
  const out = [];
  for (const cat of categories) {
    for (const q of (QUESTIONS[cat] || [])) {
      if (!seen.has(q) && out.length < 5) { seen.add(q); out.push(q); }
    }
    if (out.length >= 5) break;
  }
  return out;
}

// ── Domain override matcher ───────────────────────────────────────────────────
function matchDomainOverride(rawUrl) {
  try {
    const hostname = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl)
      .hostname.replace(/^www\./, '');
    return DOMAIN_OVERRIDES[hostname] || null;
  } catch { return null; }
}

function readBody(req) {
  return new Promise(resolve => {
    if (req.body) return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);
  let { url: targetUrl, brandName = '', market = 'UK', manualCategory } = body;
  if (!targetUrl) return res.status(400).json({ error: 'url is required' });
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  // Manual category override (from fallback UI)
  if (manualCategory && CATEGORY_DEFS[manualCategory]) {
    const categories = [manualCategory];
    const questions = buildQuestions(categories);
    const summary = `Initial analysis based on the category you selected: ${CATEGORY_DEFS[manualCategory].label}.`;
    const riskNarrative = buildRiskNarrative(brandName, manualCategory, categories);
    return res.status(200).json({
      fetchedOk: false,
      needsManualCategory: false,
      manual: true,
      title: brandName || targetUrl,
      summary,
      primary: manualCategory,
      categories: [{ key: manualCategory, label: CATEGORY_DEFS[manualCategory].label, primary: true }],
      customerType: CUSTOMER_TYPES[manualCategory] || CUSTOMER_TYPES.other,
      questions,
      riskNarrative,
    });
  }

  // Domain override
  const override = matchDomainOverride(targetUrl);

  let extracted = { title: '', metaDesc: '', ogTitle: '', ogDesc: '', headings: [], navLinks: [], bodyText: '' };
  let fetchedOk = false;

  let analysisStatus = 'ok'; // ok | blocked | failed

  if (!override) {
    try {
      const html = await fetchHtml(targetUrl);
      extracted = extract(html);
      if (isBlockedPage(extracted)) {
        analysisStatus = 'blocked';
      } else {
        fetchedOk = !!(extracted.title || extracted.metaDesc || extracted.headings.length > 0);
        if (!fetchedOk) analysisStatus = 'failed';
      }
    } catch {
      analysisStatus = 'failed';
    }
  } else {
    fetchedOk = true;
    if (override.summary) extracted.metaDesc = override.summary;
  }

  // Domain override always wins — even if scraping was blocked
  if (override) {
    analysisStatus = 'ok';
    fetchedOk = true;
  }

  // No override and blocked/failed → ask user to pick category manually
  if (!override && (analysisStatus === 'blocked' || analysisStatus === 'failed')) {
    return res.status(200).json({
      fetchedOk: false,
      needsManualCategory: true,
      analysis_status: analysisStatus,
      title: '',
      summary: '',
      categories: [],
      primary: null,
      questions: [],
      riskNarrative: '',
    });
  }

  let primary, categories;
  if (override) {
    ({ primary, categories } = override);
  } else {
    ({ primary, categories } = detectCategories(extracted));
  }

  const summary = buildSummary(extracted, brandName || extracted.title);
  const questions = buildQuestions(categories);
  const riskNarrative = buildRiskNarrative(brandName || extracted.title, primary, categories);
  const customerType = CUSTOMER_TYPES[primary] || CUSTOMER_TYPES.other;
  const categoryLabels = categories.map(c => ({
    key: c,
    label: CATEGORY_DEFS[c]?.label || c,
    primary: c === primary,
  }));

  res.status(200).json({
    fetchedOk,
    needsManualCategory: false,
    analysis_status: analysisStatus,
    manual: false,
    title: extracted.title || extracted.ogTitle,
    ogTitle: extracted.ogTitle,
    metaDescription: extracted.metaDesc,
    summary,
    primary,
    categories: categoryLabels,
    customerType,
    questions,
    riskNarrative,
  });
};
