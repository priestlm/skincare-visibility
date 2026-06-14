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
    { "channel": "e.g. Direct ecommerce / Foodservice trade / Local retail / Hospitality", "reason": "one sentence why, based on website evidence" }
  ],
  "public_signals": ["award or certification", "heritage or provenance claim", "sustainability note", "production capability", "location or region", "delivery area"],
  "target_customer_type": "short phrase",
  "market_or_location_signals": "e.g. Cornwall UK, London, nationwide UK — empty string if none",
  "example_ai_shopping_questions": [
    { "question": "specific question a real buyer would ask an AI assistant", "why_relevant": "one sentence linking this question directly to a product, service or signal found on the website" }
  ],
  "visibility_gaps": ["information that is missing or unclear from the public signals"],
  "confidence_score": 0.85,
  "evidence_used": "brief note on which signals drove classification"
}

SEVEN-STEP PROCESS — follow this order exactly:

STEP 1 — READ AND SUMMARISE.
Write business_summary in your own words. Do not copy meta descriptions or headings. Identify the organisation_name from the trading name, not blog titles or page text.

STEP 2 — EXTRACT PRODUCTS AND SERVICES.
List every product category and specific examples found in the signals. Be specific.
Examples: [{category:"Dairy products", examples:["clotted cream","dairy desserts","Cornish cream"]}]
Not: [{category:"Food", examples:["food products"]}]

STEP 3 — CLASSIFY.
primary_category must follow from what products_or_services_found shows.
- Dairy producer → "Food & drink"
- Coffee roaster → "Food & drink"
- Brewery → "Food & drink"
- Skincare brand → "Beauty & skincare"
- Pet retailer → "Pet products"
Never default to "General retail" for a specialist producer.

STEP 4 — IDENTIFY CUSTOMER CHANNELS.
Based on signals (nav links, headings, body text), identify how this business sells:
ecommerce, wholesale/trade, foodservice, hospitality, local retail, visitors/tourism, national delivery.
For each channel give a one-sentence reason based on website evidence.

STEP 5 — NOTE PUBLIC SIGNALS.
List awards, certifications, provenance claims (e.g. "Cornish made", "family farm"), sustainability claims, production capability, stockists, delivery areas, reviews or heritage.

STEP 6 — GENERATE EVIDENCE-BASED QUESTIONS.
Write 5 questions a real customer, trade buyer or visitor would ask an AI assistant.
Rules:
- Every question must relate directly to a product, service or signal in this profile.
- Every question must have a why_relevant sentence linking it to specific website evidence.
- Do NOT write about products not found on this website.
- Do NOT write about coffee, chocolate, gin, bakery, skincare, clothing, tourism unless those are in products_or_services_found.
- Prefer practical buyer-style questions: sourcing, quality, availability, trade supply, local, sustainable, delivery.

STEP 7 — VALIDATE QUESTIONS.
Before finalising, check every question. If any product, service, sector or location in the question is NOT directly supported by products_or_services_found or public_signals, delete it and replace it with a supported question.

STRICT RULES:
- secondary_categories: only include if the website clearly sells those products. Never add "Fashion & apparel" or "General retail" to a specialist producer.
- detected_niche: be specific. "Cornish clotted cream" not just "dairy". "Speciality coffee roaster" not just "coffee".
- organisation_name: trading name only, not a page title or heading.
- visibility_gaps: note anything that would help a buyer but is not publicly visible.

CORRECT EXAMPLES:
- Cornish dairy: products=[{category:"Dairy",examples:["clotted cream","dairy desserts"]}], niche="Cornish clotted cream", questions only about clotted cream, cream teas, dairy sourcing, Cornish food
- Coffee roaster: products=[{category:"Coffee",examples:["single-origin beans","subscriptions"]}], niche="Speciality coffee roaster", questions only about coffee
- Brewery: products=[{category:"Beer",examples:["pale ale","IPA","lager"]}], channels=[{channel:"On-trade pubs",reason:"nav shows trade enquiry page"}], questions about beer, pub supply, local availability
- Next.co.uk: products=[{category:"Clothing",examples:["women's fashion","men's clothing"]},{category:"Homeware",examples:["furniture","bedding"]}], questions about fashion and homeware

INCORRECT (never do this):
- Dairy → questions about gin or pasta sauce ✗
- Coffee roaster → questions about women's jeans ✗
- Any specialist → secondary category "General retail" without clear evidence ✗

Supported primary_category values (use exact strings):
Fashion & apparel | Beauty & skincare | Homeware & décor | Food & drink | Grocery & supermarket | Supplements & wellness | Pet products | Fitness & sports | Baby & kids | Electronics & accessories | Professional services | Local services | General retail / department store | Other

Additional rules:
- Do not claim to have checked ChatGPT, Gemini, Perplexity or Google AI results.
- Use phrases like "initial preview", "public website signals", "detected products", "example AI-shopping questions".
- confidence_score: 0.0–1.0. Use 0.6–0.75 if website blocked access.
- If access was blocked, infer from URL/domain and general brand knowledge only.

Website signals:
${signalsBlock}`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const result = await postJson(endpoint, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
    });

    if (result.status !== 200) {
      console.error('Gemini API error', result.status, JSON.stringify(result.body).slice(0, 300));
      return { _error: `api_status_${result.status}` };
    }

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

  // Normalise to [{question, why_relevant}]
  const normalisedQs = rawAiQs.map(q => {
    if (typeof q === 'string') return { question: q, why_relevant: '' };
    if (q && typeof q.question === 'string') return { question: q.question, why_relevant: q.why_relevant || '' };
    return null;
  }).filter(Boolean).filter(q => q.question.length > 5).slice(0, 5);

  // Niche template lookup
  const nicheLower = detectedNiche.toLowerCase();
  const nicheTemplate = Object.entries(NICHE_QUESTIONS)
    .find(([k]) => nicheLower.includes(k))?.[1] || null;
  const categoryTemplate = QUESTIONS[primaryKey] || QUESTIONS.other;

  // Validate questions: must not contain exclusive terms from a different category
  // AND if products known, must relate to at least one
  const productTerms = productsFound.map(p => p.toLowerCase());
  function questionIsValid(q) {
    const ql = q.question.toLowerCase();
    if (questionMismatch(ql, primaryKey)) return false;
    if (productTerms.length >= 2) {
      const nicheWords = nicheLower.split(/[\s\/,]+/).filter(w => w.length > 3);
      return [...productTerms, ...nicheWords].some(t => ql.includes(t));
    }
    return true;
  }

  const validQs = normalisedQs.filter(questionIsValid);

  // Pad with fallbacks (as plain strings, no why_relevant)
  const fallbackPool = nicheTemplate ? [...nicheTemplate, ...categoryTemplate] : [...categoryTemplate];
  const seen = new Set(validQs.map(q => q.question.toLowerCase()));
  const finalQs = [...validQs];
  for (const q of fallbackPool) {
    if (finalQs.length >= 5) break;
    if (!seen.has(q.toLowerCase())) {
      finalQs.push({ question: q, why_relevant: '' });
      seen.add(q.toLowerCase());
    }
  }
  if (finalQs.length < 2) {
    (nicheTemplate || categoryTemplate).slice(0, 5).forEach(q => {
      if (finalQs.length < 5) finalQs.push({ question: q, why_relevant: '' });
    });
  }

  // For backward-compat: also expose plain string array
  const questionsPlain = finalQs.map(q => q.question);

  const brandName = gemini.brand_name || brandNameInput || '';
  const summary = gemini.business_summary || '';
  const customerType = gemini.target_customer_type || gemini.likely_customer_type || CUSTOMER_TYPES[primaryKey] || CUSTOMER_TYPES.other;

  return {
    primaryKey, categories,
    questions: questionsPlain,
    questionsRich: finalQs,
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
      const { primaryKey, categories, questions, questionsRich, brandName: aiBrand, organisationName, summary, customerType, detectedNiche, productsFound, productsStructured, customerChannels, publicSignals, visibilityGaps, locationSignals } = mapped;
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
        customerType, questions, questionsRich, riskNarrative,
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
  let aiExtras = {};
  let detectedNiche = null, productsFound = [], productsStructured = [];
  let customerChannels = [], publicSignals = [], visibilityGaps = [];
  let organisationName = '', locationSignals = null;

  if (override) {
    ({ primary, categories } = override);
    const geminiRaw = await callGemini(extracted, targetUrl, 'ok');
    const gemini = geminiRaw && !geminiRaw._error ? geminiRaw : null;
    if (gemini) {
      const mapped = applyGeminiResult(gemini, brandName || extracted.title);
      questions = mapped.questions; questionsRich = mapped.questionsRich;
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
      questions = buildQuestions(categories); questionsRich = questions.map(q => ({ question: q, why_relevant: '' }));
      summary = buildSummary(extracted, brandName || extracted.title);
      customerType = CUSTOMER_TYPES[primary] || CUSTOMER_TYPES.other;
      if (geminiRaw?._error) aiExtras = { geminiError: geminiRaw._error };
    }
  } else {
    const geminiRaw = await callGemini(extracted, targetUrl, analysisStatus);
    const gemini = geminiRaw && !geminiRaw._error ? geminiRaw : null;
    if (gemini) {
      const mapped = applyGeminiResult(gemini, brandName || extracted.title);
      primary = mapped.primaryKey; categories = mapped.categories;
      questions = mapped.questions; questionsRich = mapped.questionsRich;
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
      questions = buildQuestions(categories); questionsRich = questions.map(q => ({ question: q, why_relevant: '' }));
      summary = buildSummary(extracted, brandName || extracted.title);
      customerType = CUSTOMER_TYPES[primary] || CUSTOMER_TYPES.other;
      if (geminiRaw?._error) aiExtras = { geminiError: geminiRaw._error };
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
    questions, questionsRich, riskNarrative,
    geminiKeyPresent: !!process.env.GEMINI_API_KEY,
    ...aiExtras,
  });
};
