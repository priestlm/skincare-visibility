const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── Blocked/error page detection ─────────────────────────────────────────────
const BLOCKED_SIGNALS = [
  'access denied', 'forbidden', '403 forbidden', 'request blocked',
  'bot protection', 'just a moment', 'checking your browser',
  'enable javascript and cookies', 'ddos protection', 'akamai',
  'ray id', 'cf-ray', 'attention required', 'security check',
  'please enable cookies', 'are you human',
];
const BLOCKED_TITLES = [
  'access denied', 'forbidden', '403', 'error', 'blocked', 'just a moment',
  'attention required', 'bot check', 'security check',
];

function isBlockedPage(extracted) {
  const { title, bodyText } = extracted;
  const titleLower = (title || '').toLowerCase();
  const bodyLower = (bodyText || '').toLowerCase().slice(0, 2000);
  if (BLOCKED_TITLES.some(t => titleLower === t || titleLower.startsWith(t + ' '))) return true;
  const bodyMeaningful = bodyText.replace(/\s+/g, ' ').trim().length;
  if (bodyMeaningful < 500 && BLOCKED_SIGNALS.some(s => bodyLower.includes(s))) return true;
  if (bodyMeaningful < 100) return true;
  return false;
}

// ── Known-domain overrides ────────────────────────────────────────────────────
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
    label: 'General retail / department store',
    keywords: [
      'department store', 'superstore', 'retail', 'marketplace', 'gift', 'gifts', 'sale',
      'clearance', 'outlet', 'discount', 'offer', 'deals', 'multipack', 'bundle',
      'wide range', 'shop online', 'free delivery', 'returns policy', 'click and collect',
      'next day delivery', 'gift card', 'wishlist', 'order tracking',
    ],
  },
};

// Reverse map: Gemini label → internal key
const LABEL_TO_KEY = {};
for (const [key, def] of Object.entries(CATEGORY_DEFS)) {
  LABEL_TO_KEY[def.label.toLowerCase()] = key;
}
// Extra aliases Gemini might use
const LABEL_ALIASES = {
  'fashion & apparel': 'fashion',
  'beauty & skincare': 'beauty',
  'homeware & décor': 'homeware',
  'homeware & decor': 'homeware',
  'food & drink': 'food',
  'grocery & supermarket': 'grocery',
  'supplements & wellness': 'supplements',
  'pet products': 'pets',
  'fitness & sports': 'fitness',
  'baby & kids': 'baby-kids',
  'electronics & accessories': 'electronics',
  'electronics accessories': 'electronics',
  'professional services': 'professional-services',
  'local services': 'local-services',
  'general retail': 'general-retail',
  'general retail / department store': 'general-retail',
  'department store': 'general-retail',
  'other': 'other',
};

function labelToKey(label) {
  if (!label) return null;
  const lower = label.toLowerCase().trim();
  return LABEL_TO_KEY[lower] || LABEL_ALIASES[lower] || null;
}

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

// ── Category detection (rules-based fallback) ─────────────────────────────────
function detectCategories(extracted) {
  const { title, metaDesc, ogTitle, ogDesc, headings, navLinks, bodyText } = extracted;
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

// ── Gemini AI classification ───────────────────────────────────────────────────
function postJson(url, payload, timeout = 12000) {
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

async function callGemini(extracted, targetUrl, analysisStatus) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const { title, metaDesc, ogTitle, ogDesc, headings, navLinks, bodyText } = extracted;
  const isBlocked = analysisStatus === 'blocked' || analysisStatus === 'failed';

  const signalsBlock = isBlocked
    ? `Note: The website blocked automated access. Only the URL/domain is available as a signal.\nURL: ${targetUrl}`
    : [
      `URL: ${targetUrl}`,
      title       ? `Page title: ${title}` : '',
      ogTitle     ? `OG title: ${ogTitle}` : '',
      metaDesc    ? `Meta description: ${metaDesc}` : '',
      ogDesc      ? `OG description: ${ogDesc}` : '',
      headings.length ? `Headings: ${headings.slice(0, 8).join(' | ')}` : '',
      navLinks.length ? `Navigation links: ${navLinks.slice(0, 20).join(', ')}` : '',
      bodyText    ? `Body text snippet: ${bodyText.slice(0, 1200)}` : '',
    ].filter(Boolean).join('\n');

  const prompt = `You are an AI shopping and search visibility analyst. Analyse the public website signals below and produce a structured business profile.

Return ONLY a valid JSON object — no markdown, no code fences, no explanation. Use exactly these fields:

{
  "organisation_name": "legal or trading name — NOT a blog post title or page heading",
  "brand_name": "short name shoppers would search for",
  "business_summary": "2–3 sentence plain-English summary written in your own words — do NOT copy page text verbatim",
  "primary_category": "one exact category from the list below",
  "secondary_categories": [],
  "detected_niche": "specific sub-type within primary category, e.g. Cornish clotted cream, Speciality coffee roaster, Clinical skincare — empty string if none",
  "products_or_services_found": [
    { "category": "category label", "examples": ["specific product 1", "specific product 2"] }
  ],
  "customer_channels": [
    { "channel": "e.g. Direct ecommerce / Foodservice trade / Local retail / Hospitality venues", "reason": "one sentence citing the specific nav link, heading or text that supports this" }
  ],
  "public_signals": ["award or certification found", "heritage or provenance claim", "sustainability note", "production capability", "location or region", "delivery area"],
  "target_customer_type": "short phrase",
  "market_or_location_signals": "e.g. Cornwall UK, London, nationwide UK — empty string if none",
  "question_evidence_inventory": {
    "allowed_product_terms": ["every product and service type found — these are the ONLY topics questions may cover"],
    "allowed_channel_terms": ["every sales channel found, e.g. pub trade, ecommerce, wholesale, foodservice"],
    "allowed_location_terms": ["every location or region found, e.g. Cornwall, South West, nationwide UK"],
    "allowed_signal_terms": ["heritage claims, awards, sustainability, production method, stockist type"]
  },
  "example_ai_shopping_questions": [
    {
      "question": "question a real buyer, trade customer or visitor would ask an AI assistant",
      "why_relevant": "one sentence naming the specific product, channel or signal from question_evidence_inventory that this question draws from",
      "evidence_term": "the single most important term from question_evidence_inventory that this question relies on"
    }
  ],
  "visibility_gaps": ["information that is missing or unclear from the public signals — things a buyer would want to know but cannot find"],
  "confidence_score": 0.85,
  "evidence_used": "brief note on which signals drove classification"
}

EIGHT-STEP PROCESS — follow this order exactly:

STEP 1 — READ AND SUMMARISE.
Write business_summary in your own words. Do not copy meta descriptions or headings verbatim. Identify organisation_name from the trading name, not blog post titles or page headings.

STEP 2 — EXTRACT PRODUCTS AND SERVICES.
List every distinct product category and specific named examples found in the signals. Be precise — not generic.
GOOD: [{category:"Cask ales and lagers", examples:["Tribute Pale Ale","Korev Lager","HSD"]}]
BAD:  [{category:"Food and drink", examples:["drinks","products"]}]
If no products are clearly named, describe the service type instead.

STEP 3 — CLASSIFY.
primary_category must follow from products_or_services_found, not from the company name alone.
- Dairy producer → "Food & drink"
- Brewery → "Food & drink"
- Skincare brand → "Beauty & skincare"
Never assign "General retail" to a specialist producer without clear evidence of broad retail.

STEP 4 — IDENTIFY CUSTOMER CHANNELS.
List only channels you can directly evidence from nav links, headings, or body text:
ecommerce shop, wholesale/trade enquiry, foodservice supply, hospitality venues, local retail, visitor experiences, national delivery.
Each channel needs a one-sentence reason citing specific website evidence.

STEP 5 — NOTE PUBLIC SIGNALS.
List only signals explicitly present: awards, certifications, heritage claims, sustainability statements, production facts, named stockists, delivery areas, years established, family/local ownership claims.

STEP 6 — BUILD EVIDENCE INVENTORY.
Complete question_evidence_inventory using ONLY what you found in Steps 2–5.
This inventory defines every topic that questions are PERMITTED to cover.
Do not add topics that were not found in the website signals.

STEP 7 — GENERATE EVIDENCE-BASED QUESTIONS.
Write exactly 5 questions. Each question MUST:
a) Reference at least one term from question_evidence_inventory (allowed_product_terms OR allowed_channel_terms OR allowed_location_terms OR allowed_signal_terms)
b) Be the kind of question a real buyer, trade customer or visitor would ask an AI assistant about this specific business
c) Include a why_relevant sentence naming the inventory term it uses
d) Include an evidence_term naming the single most important inventory term

Topics NOT allowed unless found in question_evidence_inventory:
- Coffee, tea, chocolate, gin, whisky, wine, pasta, bakery, skincare, clothing, tourism, electronics, pets, fitness — unless this specific business sells those things

STEP 8 — VALIDATE QUESTIONS.
For each of the 5 questions, check: does evidence_term appear in question_evidence_inventory?
If NO → delete the question and write a new one that does use an inventory term.
If fewer than 5 inventory-supported questions are possible, write as many as the evidence supports and leave the rest out.

STRICT RULES:
- secondary_categories: only if the website clearly sells those products. Never add "General retail" to a specialist.
- detected_niche: be specific ("Cornish cask ale brewery" not just "brewery").
- organisation_name: trading name only.
- visibility_gaps: things a buyer needs but cannot find on the public website.

CORRECT EXAMPLES:
- St Austell Brewery: products=[{category:"Cask ales and lagers",examples:["Tribute Pale Ale","Korev"]}], channels=[{channel:"On-trade pub supply",reason:"trade page in nav"},{channel:"Visitor experiences",reason:"brewery tours listed"}], inventory={products:["cask ale","lager","beer"],channels:["pub trade","wholesale","brewery tours"],location:["Cornwall","South West"]}, questions about beer, pub supply, Cornwall, brewery tours
- Ehrmann Cornish Dairy: products=[{category:"Dairy desserts",examples:["yoghurt","clotted cream","dairy desserts"]}], questions about dairy, desserts, clotted cream, foodservice, Cornish provenance
- Next.co.uk: products=[clothing,homeware], questions about fashion and homeware ONLY

INCORRECT (never do this):
- St Austell Brewery → questions about coffee, chocolate, gin, pasta, skincare ✗
- Cornish dairy → questions about craft beer or clothing ✗
- Any specialist → questions drawn from broad category bank rather than extracted products ✗

Supported primary_category values (use exact strings):
Fashion & apparel | Beauty & skincare | Homeware & décor | Food & drink | Grocery & supermarket | Supplements & wellness | Pet products | Fitness & sports | Baby & kids | Electronics & accessories | Professional services | Local services | General retail / department store | Other

Additional rules:
- confidence_score: 0.0–1.0. Use 0.6–0.75 if website blocked access.
- If access was blocked, infer from URL/domain and general brand knowledge only, and note this in evidence_used.

Website signals:
${signalsBlock}`;

  // Model fallback chain — if the primary model is rate-limited, try the next one.
  const MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite'];
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
  };

  let result, usedModel;
  try {
    for (const model of MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      result = await postJson(endpoint, payload);
      usedModel = model;
      if (result.status === 200) break;
      // On 429 or 404 try the next model; on other errors stop immediately
      const bodyStr = JSON.stringify(result.body).slice(0, 400);
      console.error(`Gemini ${model} error`, result.status, bodyStr);
      if (result.status !== 429 && result.status !== 404) break;
    }

    if (result.status !== 200) {
      const errDetail = result.body?.error?.message || result.body?.error?.status || '';
      return { _error: `api_status_${result.status}`, _errorDetail: errDetail };
    }
    console.log(`Gemini model used: ${usedModel}`);

    const text = result.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip any accidental markdown fences
    const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.primary_category || !parsed.example_ai_shopping_questions) {
      return { _error: 'missing_fields' };
    }

    return parsed;
  } catch (err) {
    console.error('Gemini call failed:', err.message);
    return { _error: err.message || 'unknown' };
  }
}

// ── Niche question templates ───────────────────────────────────────────────────
const NICHE_QUESTIONS = {
  'speciality coffee': [
    'best speciality coffee roasters in the UK',
    'best single origin coffee subscription UK',
    'best direct-trade coffee beans online',
    'best sustainable coffee brands UK',
    'best small-batch coffee roasters to buy from online',
  ],
  'specialty coffee': [
    'best speciality coffee roasters in the UK',
    'best single origin coffee subscription UK',
    'best direct-trade coffee beans online',
    'best sustainable coffee brands UK',
    'best small-batch coffee roasters to buy from online',
  ],
  'clinical skincare': [
    'best clinical skincare serums for sensitive skin',
    'best evidence-based retinol serum UK',
    'best affordable niacinamide serum UK',
    'best cruelty-free acid exfoliant UK',
    'best skincare routine for hyperpigmentation UK',
  ],
  'sustainable fashion': [
    'best sustainable fashion brands UK 2025',
    'best ethical clothing brands UK',
    'best slow fashion brands for women UK',
    'best organic cotton clothing UK',
    'best certified sustainable fashion labels UK',
  ],
  'raw pet food': [
    'best raw dog food delivery UK',
    'best BARF diet for dogs UK',
    'best raw cat food brands UK',
    'is raw pet food safe for dogs UK',
    'best freeze-dried raw dog food UK',
  ],
  'premium pet food': [
    'best premium dog food UK 2025',
    'best grain-free dog food UK',
    'best natural cat food brands UK',
    'best high-protein dog food UK',
    'best subscription dog food delivery UK',
  ],
  'cornish dairy': [
    'best Cornish clotted cream to buy online',
    'best clotted cream for afternoon tea',
    'best British dairy dessert brands',
    'best cream for scones UK',
    'best traditional Cornish food gifts online',
  ],
  'clotted cream': [
    'best Cornish clotted cream to buy online',
    'best clotted cream for afternoon tea',
    'best cream for scones UK',
    'best traditional Cornish food gifts online',
    'best British dairy desserts to order online',
  ],
  'dairy products': [
    'best British dairy brands online',
    'best clotted cream UK',
    'best artisan dairy products to buy online',
    'best cream teas delivered UK',
    'best traditional dairy desserts UK',
  ],
  'cornish food': [
    'best Cornish food gifts to order online',
    'best traditional Cornish food brands',
    'best Cornish clotted cream UK',
    'best cream tea delivery UK',
    'best artisan Cornish food producers',
  ],
  'artisan chocolate': [
    'best artisan chocolate brands UK 2025',
    'best bean-to-bar chocolate UK',
    'best dark chocolate gifts UK',
    'best British chocolate makers',
    'best craft chocolate subscription UK',
  ],
  'craft gin': [
    'best craft gin distilleries UK 2025',
    'best small-batch gin UK',
    'best botanical gin UK',
    'best British gin brands',
    'best gin gift sets UK',
  ],
};

// Exclusive terms per category — words that signal a question belongs to THAT category only.
// Used to detect cross-category contamination in AI-generated questions.
const EXCLUSIVE_TERMS = {
  fashion:              ['jeans', 'coat', 'dress', 'jacket', 'trainers', 'boots', 'handbag', 'lingerie', 'swimwear', 'womenswear', 'menswear', 'denim', 'blazer', 'skirt'],
  beauty:               ['serum', 'moisturiser', 'moisturizer', 'retinol', 'niacinamide', 'spf', 'sunscreen', 'cleanser', 'toner', 'primer', 'foundation', 'mascara', 'lipstick'],
  homeware:             ['sofa', 'bedding', 'duvet', 'curtains', 'rug', 'cookware', 'tableware', 'chest of drawers', 'wall art'],
  food:                 ['coffee', 'tea', 'gin', 'whisky', 'beer', 'wine', 'chocolate', 'sauce', 'pasta', 'honey', 'roast', 'brew', 'bean', 'roaster'],
  grocery:              ['supermarket', 'delivery pass', 'clubcard', 'nectar', 'weekly shop', 'click and collect', 'fresh produce'],
  supplements:          ['vitamin', 'supplement', 'collagen', 'probiotic', 'omega', 'protein powder', 'magnesium', 'whey', 'creatine'],
  pets:                 ['dog food', 'cat food', 'puppy', 'kitten', 'collar', 'harness', 'litter', 'dog treat', 'cat treat', 'flea', 'worming', 'vet'],
  fitness:              ['yoga mat', 'resistance band', 'dumbbell', 'kettlebell', 'activewear', 'gym', 'workout', 'running shoe', 'marathon', 'crossfit'],
  'baby-kids':          ['pushchair', 'pram', 'nappy', 'buggy', 'cot', 'newborn', 'teething', 'baby food', 'car seat', 'stroller'],
  electronics:          ['earbuds', 'laptop', 'smartwatch', 'charger', 'router', 'broadband', 'gaming', 'console', 'airpods', 'tablet'],
  'professional-services': ['accountant', 'solicitor', 'marketing agency', 'it support', 'hr software'],
  'local-services':     ['near me', 'plumber', 'electrician', 'salon', 'barber', 'dentist', 'cleaner'],
  'general-retail':     ['department store', 'next day delivery', 'gift card', 'order tracking'],
};

// Returns true if the question text contains terms exclusive to a DIFFERENT category
function questionMismatch(questionLower, primaryKey) {
  for (const [cat, terms] of Object.entries(EXCLUSIVE_TERMS)) {
    if (cat === primaryKey) continue;
    if (terms.some(t => questionLower.includes(t))) return true;
  }
  return false;
}

// ── Map Gemini result to our internal schema ───────────────────────────────────
function applyGeminiResult(gemini, brandNameInput) {
  const primaryKey = labelToKey(gemini.primary_category) || 'other';
  const secondaryKeys = (gemini.secondary_categories || [])
    .map(l => labelToKey(l))
    .filter(Boolean)
    .filter(k => k !== primaryKey);

  const categories = [primaryKey, ...secondaryKeys].slice(0, 4);

  const detectedNiche = typeof gemini.detected_niche === 'string'
    ? gemini.detected_niche.trim()
    : '';

  // products_or_services_found can be [{category, examples}] (new) or [string] (legacy)
  const rawProds = Array.isArray(gemini.products_or_services_found) ? gemini.products_or_services_found : [];
  let productsFound = [];       // flat string list for display
  let productsStructured = [];  // [{category, examples}] for richer display
  for (const p of rawProds) {
    if (typeof p === 'string' && p.length > 1) {
      productsFound.push(p);
    } else if (p && typeof p === 'object' && Array.isArray(p.examples)) {
      productsStructured.push({ category: p.category || '', examples: p.examples.filter(e => typeof e === 'string') });
      productsFound.push(...p.examples.filter(e => typeof e === 'string'));
    }
  }

  // customer_channels: [{channel, reason}]
  const customerChannels = Array.isArray(gemini.customer_channels)
    ? gemini.customer_channels.filter(c => c && typeof c.channel === 'string')
    : [];

  // public_signals: [string]
  const publicSignals = Array.isArray(gemini.public_signals)
    ? gemini.public_signals.filter(s => typeof s === 'string' && s.length > 1)
    : [];

  // visibility_gaps: [string]
  const visibilityGaps = Array.isArray(gemini.visibility_gaps)
    ? gemini.visibility_gaps.filter(s => typeof s === 'string' && s.length > 1)
    : [];

  const organisationName = typeof gemini.organisation_name === 'string'
    ? gemini.organisation_name.trim()
    : '';

  const locationSignals = typeof gemini.market_or_location_signals === 'string'
    ? gemini.market_or_location_signals.trim()
    : '';

  // example_ai_shopping_questions can be [{question, why_relevant}] (new) or [string] (legacy)
  const rawAiQs = Array.isArray(gemini.example_ai_shopping_questions)
    ? gemini.example_ai_shopping_questions
    : [];

  // Normalise to [{question, why_relevant, evidence_term}]
  const normalisedQs = rawAiQs.map(q => {
    if (typeof q === 'string') return { question: q, why_relevant: '', evidence_term: '' };
    if (q && typeof q.question === 'string') return { question: q.question, why_relevant: q.why_relevant || '', evidence_term: q.evidence_term || '' };
    return null;
  }).filter(Boolean).filter(q => q.question.length > 5).slice(0, 5);

  // Build a supported-terms set from everything Gemini extracted about this business.
  // Questions must use terms from this set — not generic category language.
  const STOP_WORDS = new Set(['best','most','good','great','find','where','what','which','does','have','with','from','that','this','your','their','some','will','more','very','into','just','also','only','when','then','than','them','they','been','were','make','made','such','each','much','many','both','even','well','over','here','how','for','can','the','and','are','has','its','was','not','but','our','all','any','get','per','via','new']);
  const evidenceTerms = new Set();

  // From products/services
  for (const cat of productsStructured) {
    cat.category.toLowerCase().split(/[\s\/,&]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));
    for (const ex of (cat.examples || [])) {
      ex.toLowerCase().split(/[\s\/,&]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));
    }
  }

  // From channels
  for (const ch of customerChannels) {
    ch.channel.toLowerCase().split(/[\s\/,&]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));
  }

  // From public signals
  for (const sig of publicSignals) {
    sig.toLowerCase().split(/[\s\/,&]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));
  }

  // From location and niche
  const nicheLower = detectedNiche.toLowerCase();
  if (locationSignals) locationSignals.toLowerCase().split(/[\s,\/]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));
  nicheLower.split(/[\s\/,]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));

  // Also absorb Gemini's own evidence inventory if present
  const inv = gemini.question_evidence_inventory;
  if (inv && typeof inv === 'object') {
    for (const list of Object.values(inv)) {
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === 'string') {
            item.toLowerCase().split(/[\s\/,&]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));
          }
        }
      }
    }
  }

  // Organisation/brand name words are always allowed
  if (organisationName) organisationName.toLowerCase().split(/\s+/).filter(w => w.length > 2).forEach(w => evidenceTerms.add(w));

  // Validate each question: cross-category check + evidence-term check.
  // A question passes if:
  //   (a) it doesn't use exclusive terms from a different category, AND
  //   (b) at least one meaningful content word in the question appears in evidenceTerms
  function questionSupported(q) {
    const ql = q.question.toLowerCase();
    if (questionMismatch(ql, primaryKey)) return false;
    // Check evidence_term field first (Gemini named it explicitly)
    if (q.evidence_term && typeof q.evidence_term === 'string') {
      const et = q.evidence_term.toLowerCase().trim();
      if (et.length > 2 && evidenceTerms.has(et)) return true;
      // Try individual words of evidence_term
      const etWords = et.split(/[\s\/,&]+/).filter(w => w.length > 2);
      if (etWords.some(w => evidenceTerms.has(w))) return true;
    }
    // Fallback: check question words against evidence terms
    const words = ql.split(/[\s\/,'"?!.]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
    return words.some(w => evidenceTerms.has(w));
  }

  const validQs = normalisedQs.filter(questionSupported);

  // Never pad AI-assisted questions with preloaded or generic templates.
  // If Gemini didn't generate enough supported questions, say so — don't invent.
  let weakEvidence = false;
  const finalQs = [...validQs];
  if (finalQs.length < 3) weakEvidence = true;

  // For backward-compat: also expose plain string array
  const questionsPlain = finalQs.map(q => q.question);

  const brandName = gemini.brand_name || brandNameInput || '';
  const summary = gemini.business_summary || '';
  const customerType = gemini.target_customer_type || gemini.likely_customer_type || CUSTOMER_TYPES[primaryKey] || CUSTOMER_TYPES.other;

  return {
    primaryKey, categories,
    questions: questionsPlain,
    questionsRich: finalQs,
    weakEvidence,
    brandName, organisationName, summary, customerType,
    detectedNiche, productsFound, productsStructured,
    customerChannels, publicSignals, visibilityGaps, locationSignals,
  };
}

// ── Summary / narrative builders ──────────────────────────────────────────────
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
      aiAssisted: false,
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

  // No override and blocked/failed → try Gemini with domain-only signal, else ask user
  if (!override && (analysisStatus === 'blocked' || analysisStatus === 'failed')) {
    const geminiRaw = await callGemini(extracted, targetUrl, analysisStatus);
    const gemini = geminiRaw && !geminiRaw._error ? geminiRaw : null;
    if (gemini) {
      const mapped = applyGeminiResult(gemini, brandName);
      const { primaryKey, categories, questions, questionsRich, weakEvidence, brandName: aiBrand, organisationName, summary, customerType, detectedNiche, productsFound, productsStructured, customerChannels, publicSignals, visibilityGaps, locationSignals } = mapped;
      const riskNarrative = buildRiskNarrative(aiBrand || brandName, primaryKey, categories);
      const categoryLabels = categories.map(c => ({
        key: c, label: CATEGORY_DEFS[c]?.label || c, primary: c === primaryKey,
      }));
      return res.status(200).json({
        fetchedOk: false, needsManualCategory: false,
        analysis_status: analysisStatus, aiAssisted: true, geminiKeyPresent: true, manual: false,
        title: organisationName || aiBrand || brandName || targetUrl,
        organisationName: organisationName || aiBrand || brandName || targetUrl,
        summary, primary: primaryKey, niche: detectedNiche || null,
        productsFound, productsStructured, customerChannels, publicSignals, visibilityGaps,
        locationSignals: locationSignals || null, categories: categoryLabels,
        customerType, questions, questionsRich, weakEvidence: weakEvidence || false, riskNarrative,
        confidence: gemini.confidence_score, analysisNotes: gemini.analysis_notes,
      });
    }
    // No Gemini key or Gemini failed — ask user to pick category manually
    return res.status(200).json({
      fetchedOk: false,
      needsManualCategory: true,
      aiAssisted: false,
      geminiKeyPresent: !!process.env.GEMINI_API_KEY,
      geminiError: geminiRaw?._error || null,
      analysis_status: analysisStatus,
      title: '',
      summary: '',
      categories: [],
      primary: null,
      questions: [],
      riskNarrative: '',
    });
  }

  // ── Classify: try Gemini first, fall back to rules-based ─────────────────────
  let primary, categories, summary, questions, questionsRich = [], customerType, aiAssisted = false;
  let aiExtras = {}, weakEvidence = false;
  let detectedNiche = null, productsFound = [], productsStructured = [];
  let customerChannels = [], publicSignals = [], visibilityGaps = [];
  let organisationName = '', locationSignals = null;

  if (override) {
    ({ primary, categories } = override);
    const geminiRaw = await callGemini(extracted, targetUrl, 'ok');
    const gemini = geminiRaw && !geminiRaw._error ? geminiRaw : null;
    if (gemini) {
      const mapped = applyGeminiResult(gemini, brandName || extracted.title);
      questions = mapped.questions; questionsRich = mapped.questionsRich; weakEvidence = mapped.weakEvidence || false;
      summary = mapped.summary || buildSummary(extracted, brandName || extracted.title);
      customerType = mapped.customerType; detectedNiche = mapped.detectedNiche || null;
      productsFound = mapped.productsFound || []; productsStructured = mapped.productsStructured || [];
      customerChannels = mapped.customerChannels || []; publicSignals = mapped.publicSignals || [];
      visibilityGaps = mapped.visibilityGaps || [];
      organisationName = mapped.organisationName || mapped.brandName || '';
      locationSignals = mapped.locationSignals || null;
      aiAssisted = true;
      aiExtras = { confidence: gemini.confidence_score, analysisNotes: gemini.analysis_notes };
    } else {
      summary = buildSummary(extracted, brandName || extracted.title);
      customerType = CUSTOMER_TYPES[primary] || CUSTOMER_TYPES.other;
      if (geminiRaw?._error) {
        aiExtras = { geminiError: geminiRaw._error, geminiErrorDetail: geminiRaw._errorDetail || '' };
        // Gemini key present but call failed — don't show generic category questions
        // that are unrelated to this business. Show weak-evidence warning instead.
        questions = []; questionsRich = []; weakEvidence = true;
      } else {
        questions = buildQuestions(categories); questionsRich = questions.map(q => ({ question: q, why_relevant: '' }));
      }
    }
  } else {
    const geminiRaw = await callGemini(extracted, targetUrl, analysisStatus);
    const gemini = geminiRaw && !geminiRaw._error ? geminiRaw : null;
    if (gemini) {
      const mapped = applyGeminiResult(gemini, brandName || extracted.title);
      primary = mapped.primaryKey; categories = mapped.categories;
      questions = mapped.questions; questionsRich = mapped.questionsRich; weakEvidence = mapped.weakEvidence || false;
      summary = mapped.summary || buildSummary(extracted, brandName || extracted.title);
      customerType = mapped.customerType; detectedNiche = mapped.detectedNiche || null;
      productsFound = mapped.productsFound || []; productsStructured = mapped.productsStructured || [];
      customerChannels = mapped.customerChannels || []; publicSignals = mapped.publicSignals || [];
      visibilityGaps = mapped.visibilityGaps || [];
      organisationName = mapped.organisationName || mapped.brandName || '';
      locationSignals = mapped.locationSignals || null;
      aiAssisted = true;
      aiExtras = { confidence: gemini.confidence_score, analysisNotes: gemini.analysis_notes };
    } else {
      ({ primary, categories } = detectCategories(extracted));
      summary = buildSummary(extracted, brandName || extracted.title);
      customerType = CUSTOMER_TYPES[primary] || CUSTOMER_TYPES.other;
      if (geminiRaw?._error) {
        aiExtras = { geminiError: geminiRaw._error, geminiErrorDetail: geminiRaw._errorDetail || '' };
        // Gemini key present but call failed — don't show generic category questions
        // that are unrelated to this business. Show weak-evidence warning instead.
        questions = []; questionsRich = []; weakEvidence = true;
      } else {
        questions = buildQuestions(categories); questionsRich = questions.map(q => ({ question: q, why_relevant: '' }));
      }
    }
  }

  const displayTitle = organisationName || brandName || extracted.title || extracted.ogTitle || '';
  const riskNarrative = buildRiskNarrative(displayTitle, primary, categories);
  const categoryLabels = categories.map(c => ({
    key: c, label: CATEGORY_DEFS[c]?.label || c, primary: c === primary,
  }));

  res.status(200).json({
    fetchedOk, needsManualCategory: false, analysis_status: analysisStatus,
    aiAssisted, manual: false,
    title: displayTitle, ogTitle: extracted.ogTitle, metaDescription: extracted.metaDesc,
    organisationName: organisationName || null, summary,
    primary, niche: detectedNiche || null,
    productsFound, productsStructured, customerChannels, publicSignals, visibilityGaps,
    locationSignals: locationSignals || null,
    categories: categoryLabels, customerType,
    questions, questionsRich, weakEvidence, riskNarrative,
    geminiKeyPresent: !!process.env.GEMINI_API_KEY,
    ...aiExtras,
  });
};
