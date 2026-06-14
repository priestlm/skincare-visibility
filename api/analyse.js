const https = require('https');
const http = require('http');
const { URL } = require('url');

// â”€â”€ Blocked/error page detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Known-domain overrides â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    summary: 'Next is a UK fashion, homeware, kidswear and general retail brand â€” one of the UK\'s largest retailers selling clothing, footwear, accessories, furniture and home goods online and in-store.',
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

// â”€â”€ Category definitions with weighted keywords â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    label: 'Homeware & dÃ©cor',
    keywords: [
      'homeware', 'home decor', 'home dÃ©cor', 'furniture', 'sofa', 'bed', 'bedding',
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

// Reverse map: Gemini label â†' internal key
const LABEL_TO_KEY = {};
for (const [key, def] of Object.entries(CATEGORY_DEFS)) {
  LABEL_TO_KEY[def.label.toLowerCase()] = key;
}
// Extra aliases Gemini might use
const LABEL_ALIASES = {
  'fashion & apparel': 'fashion',
  'beauty & skincare': 'beauty',
  'homeware & dÃ©cor': 'homeware',
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

// â”€â”€ Question templates per category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    'best men\'s winter coat under Â£100',
    'best running trainers for beginners UK',
    'best sustainable fashion brands UK',
  ],
  beauty: [
    'best vitamin C serum for sensitive skin',
    'best moisturiser for dry skin under Â£30',
    'best cruelty-free retinol serum UK',
    'best SPF moisturiser for daily use',
  ],
  homeware: [
    'best affordable sofa UK under Â£600',
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
    'best home gym equipment under Â£200',
  ],
  'baby-kids': [
    'best lightweight pushchair 2025 UK',
    'best newborn sleeping bag',
    'best educational toys for toddlers',
    'best convertible car seat UK',
  ],
  electronics: [
    'best wireless earbuds under Â£100 UK',
    'best laptop for students UK 2025',
    'best portable charger UK',
    'best smartwatch under Â£200',
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

// â”€â”€ Customer type labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CUSTOMER_TYPES = {
  grocery:                 'shoppers researching grocery delivery, supermarket options and food value',
  fashion:                'shoppers researching clothing, footwear and accessories',
  beauty:                  'beauty shoppers researching ingredients and product results',
  homeware:                'home shoppers looking for furniture, bedding and dÃ©cor',
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

// â”€â”€ HTTP fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ HTML extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Category detection (rules-based fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ AI classification helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function postJson(url, payload, timeout = 12000, extraHeaders = {}) {
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

function buildAiPrompt(extracted, targetUrl, analysisStatus) {
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
      bodyText    ? `Body text snippet: ${bodyText.slice(0, 800)}` : '',
    ].filter(Boolean).join('\n');

  return `Analyse the website signals below. Return ONLY a valid JSON object â€” no markdown, no fences. Keep all string values under 20 words. Arrays max 5 items.

{
  "organisation_name": "trading name only",
  "brand_name": "short searchable name",
  "business_summary": "2-3 sentences in your own words",
  "primary_category": "one exact value from the category list",
  "secondary_categories": [],
  "detected_niche": "specific sub-type e.g. Cornish cask ale brewery â€” empty if none",
  "products_or_services_found": [{"category": "label", "examples": ["product 1", "product 2"]}],
  "customer_channels": [{"channel": "e.g. Direct ecommerce / Pub supply", "reason": "one sentence"}],
  "public_signals": ["award", "heritage", "location", "years trading"],
  "market_or_location_signals": "e.g. Cornwall UK â€” empty if none",
  "allowed_topics": ["topics from products/channels/signals only â€” questions must use ONLY these"],
  "likely_search_intents": ["5 real customer needs: who is searching and why, e.g. 'dad buying a beer gift', 'bar manager finding local stock', 'couple planning a day out'"],
  "example_ai_shopping_questions": [
    {"question": "natural sentence as typed to ChatGPT â€” casual plain English, real-life detail, starts with find me/I'm looking for/can you recommend/where can I get/what's a good/I need", "search_intent": "who is searching and why", "evidence_term": "single key term from allowed_topics"}
  ],
  "visibility_gaps": ["missing info a buyer would want"],
  "confidence_score": 0.85
}

RULES:
1. Classify from evidence. Brewery â†' "Food & drink". Skincare â†' "Beauty & skincare".
2. allowed_topics: ONLY topics found in the signals. Nothing invented.
3. Questions must sound like a real person talking to ChatGPT â€” casual, plain English, not marketing copy. FORBIDDEN WORDS: award-winning, premium, artisan, renowned, finest, wholesaler, on-trade, bespoke, curated, hospitality supplier. Also forbidden: business name, brand name, "you", "your".
   GOOD: "I'm looking for a local brewery in Cornwall that sells to pubs â€” any recommendations?" / "where can I get Cornish beer delivered?" / "what's a good brewery near Truro to visit for a day out?"
   BAD: "find me award-winning cask ales" / "recommend an independent brewery that supplies pubs wholesale"
4. Each question must use a term from allowed_topics. evidence_term must be in allowed_topics. Omit rather than invent.
5. Do NOT write questions about categories not in products_or_services_found.
6. confidence_score: 0.6-0.75 if website blocked.

Categories: Fashion & apparel | Beauty & skincare | Homeware & dÃ©cor | Food & drink | Grocery & supermarket | Supplements & wellness | Pet products | Fitness & sports | Baby & kids | Electronics & accessories | Professional services | Local services | General retail / department store | Other

Website signals:
${signalsBlock}`;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  // flash-lite = 30 RPM (vs flash 15 RPM) â€” use as primary to halve rate-limit exposure
  const MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash'];
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 3000 },
  };

  let result, usedModel;
  try {
    for (const model of MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      result = await postJson(endpoint, payload, 25000);
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

// â”€â”€ OpenAI-compatible chat helper (used by Groq + OpenRouter) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function callOpenAICompat(endpoint, model, apiKey, prompt, providerName) {
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You are a business analyst. Return only valid JSON. No markdown, no code fences.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 3000,
  };
  try {
    const result = await postJson(endpoint, payload, 25000, { Authorization: `Bearer ${apiKey}` });
    if (result.status !== 200) {
      console.error(`${providerName} error`, result.status, JSON.stringify(result.body).slice(0, 200));
      return { _error: `${providerName.toLowerCase()}_status_${result.status}` };
    }
    const text = result.body?.choices?.[0]?.message?.content || '';
    const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.primary_category || !parsed.example_ai_shopping_questions) {
      return { _error: `${providerName.toLowerCase()}_missing_fields` };
    }
    console.log(`${providerName} succeeded`);
    return parsed;
  } catch (err) {
    console.error(`${providerName} failed:`, err.message);
    return { _error: err.message || `${providerName.toLowerCase()}_unknown` };
  }
}

// Groq — blocks Vercel IPs; kept as option if hosting changes
function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return Promise.resolve(null);
  return callOpenAICompat('https://api.groq.com/openai/v1/chat/completions', 'llama-3.1-8b-instant', apiKey, prompt, 'Groq');
}

// OpenRouter — works from Vercel, free tier (200 RPD), no credit card required
async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  // Current free models (June 2026) — try in order
  const models = [
    'deepseek/deepseek-r1:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
  ];
  let lastErr;
  for (const model of models) {
    const result = await callOpenAICompat(endpoint, model, apiKey, prompt, `OpenRouter(${model})`);
    if (result && !result._error) return result;
    lastErr = result;
    const errStr = result?._error || '';
    // Only continue to next model on 404 or 429; stop on auth/server errors
    if (!errStr.includes('404') && !errStr.includes('429')) break;
  }
  return lastErr || { _error: 'openrouter_all_failed' };
}

// â”€â”€ AI orchestrator: Gemini â†' Groq â†' OpenRouter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function callAI(extracted, targetUrl, analysisStatus) {
  const prompt = buildAiPrompt(extracted, targetUrl, analysisStatus);

  const geminiResult = await callGemini(prompt);
  if (geminiResult && !geminiResult._error) return geminiResult;

  const groqResult = await callGroq(prompt);
  if (groqResult && !groqResult._error) return groqResult;

  const openRouterResult = await callOpenRouter(prompt);
  if (openRouterResult && !openRouterResult._error) return openRouterResult;

  // All failed — return most informative error
  return openRouterResult || geminiResult || groqResult || { _error: 'no_ai_provider' };
}

// â”€â”€ Niche question templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  'brewery': [
    'where can I get local craft beer delivered to my door?',
    'what\'s a good independent brewery to visit in the UK?',
    'I\'m looking for a local brewery that supplies pubs — any recommendations?',
    'can you recommend a brewery in the South West with a tap room to visit?',
    'where can I buy locally brewed ales online?',
  ],
  'craft beer': [
    'where can I get local craft beer delivered to my door?',
    'what\'s a good independent brewery to visit in the UK?',
    'I\'m looking for a craft beer subscription in the UK — any good ones?',
    'can you recommend a pub that stocks local craft ales?',
    'where can I buy small-batch British ales online?',
  ],
  'cask ale': [
    'where can I find real ale from a local brewery?',
    'what\'s a good cask ale brewery to visit in the UK?',
    'I\'m looking for a pub that serves local cask ales — any recommendations?',
    'where can I order traditional British ales online?',
    'can you recommend a brewery in the South West that does tours?',
  ],
};

// Exclusive terms per category â€” words that signal a question belongs to THAT category only.
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

// â”€â”€ Map Gemini result to our internal schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // example_ai_shopping_questions can be [{question, search_intent, evidence_term}] or [string] (legacy)
  const rawAiQs = Array.isArray(gemini.example_ai_shopping_questions)
    ? gemini.example_ai_shopping_questions
    : [];

  // Normalise to [{question, search_intent, evidence_term}]
  const normalisedQs = rawAiQs.map(q => {
    if (typeof q === 'string') return { question: q, search_intent: '', evidence_term: '' };
    if (q && typeof q.question === 'string') return { question: q.question, search_intent: q.search_intent || q.why_relevant || '', evidence_term: q.evidence_term || '' };
    return null;
  }).filter(Boolean).filter(q => q.question.length > 5).slice(0, 5);

  // Build a supported-terms set from everything Gemini extracted about this business.
  // Questions must use terms from this set â€” not generic category language.
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

  // Also absorb Gemini's evidence inventory (flat allowed_topics array or legacy object)
  const allowedTopics = Array.isArray(gemini.allowed_topics) ? gemini.allowed_topics : [];
  for (const item of allowedTopics) {
    if (typeof item === 'string') {
      item.toLowerCase().split(/[\s\/,&]+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => evidenceTerms.add(w));
    }
  }
  // Legacy: question_evidence_inventory object
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
  // If Gemini didn't generate enough supported questions, say so â€” don't invent.
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

// â”€â”€ Summary / narrative builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildSummary(extracted, brandName) {
  const { title, metaDesc, ogDesc, headings } = extracted;
  const best = ogDesc || metaDesc;
  if (best && best.length > 40) return best.slice(0, 240);
  if (headings.length > 0) return (title ? title + ' â€” ' : '') + headings[0];
  return title || `Initial analysis based on public website signals${brandName ? ' for ' + brandName : ''}.`;
}

function buildRiskNarrative(brandName, primary, categories) {
  const name = brandName || 'your brand';
  const catLabel = CATEGORY_DEFS[primary]?.label || primary;
  const others = categories.filter(c => c !== primary).map(c => CATEGORY_DEFS[c]?.label || c);
  const multi = others.length > 0 ? ` (and ${others.join(', ')})` : '';
  return `When shoppers ask AI assistants for ${catLabel}${multi} recommendations, they typically receive 3â€“5 brand names. Based on ${name}'s public website signals, we've identified the question types where visibility gaps are most likely. The full report shows which queries are relevant to your brand and which competitors are appearing instead.`;
}

// Detect niche from raw text signals without AI
const NICHE_KEYWORDS = [
  { niche: 'brewery',  terms: ['brewery', 'brewed', 'cask ale', 'craft beer', 'ales', 'lager', 'hops', 'brewing'] },
  { niche: 'craft beer', terms: ['craft beer', 'craft ale', 'craft lager', 'microbrewery'] },
  { niche: 'cask ale', terms: ['cask ale', 'real ale', 'cask conditioned', 'hand pump'] },
  { niche: 'speciality coffee', terms: ['speciality coffee', 'specialty coffee', 'single origin', 'coffee roaster', 'espresso'] },
  { niche: 'craft gin', terms: ['craft gin', 'gin distillery', 'small batch gin', 'botanical gin'] },
  { niche: 'artisan chocolate', terms: ['bean to bar', 'artisan chocolate', 'craft chocolate', 'cacao'] },
];

function detectNicheFromText(extracted) {
  const text = [extracted.title, extracted.metaDesc, extracted.ogTitle, extracted.ogDesc, (extracted.headings || []).join(' '), (extracted.bodyText || '').slice(0, 500)].join(' ').toLowerCase();
  for (const { niche, terms } of NICHE_KEYWORDS) {
    if (terms.some(t => text.includes(t))) return niche;
  }
  return null;
}

function buildQuestions(categories, niche) {
  const seen = new Set();
  const out = [];
  // Niche questions first if available
  if (niche) {
    for (const q of (NICHE_QUESTIONS[niche] || [])) {
      if (!seen.has(q) && out.length < 5) { seen.add(q); out.push(q); }
    }
  }
  if (out.length < 5) {
    for (const cat of categories) {
      for (const q of (QUESTIONS[cat] || [])) {
        if (!seen.has(q) && out.length < 5) { seen.add(q); out.push(q); }
      }
      if (out.length >= 5) break;
    }
  }
  return out;
}

// â”€â”€ Domain override matcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ In-memory result cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Persists across warm invocations of the same serverless instance.
// Prevents repeated Gemini calls for the same URL within a warm window.
const RESULT_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheGet(key) {
  const entry = RESULT_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { RESULT_CACHE.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  if (RESULT_CACHE.size >= 50) {
    RESULT_CACHE.delete(RESULT_CACHE.keys().next().value); // evict oldest
  }
  RESULT_CACHE.set(key, { data, ts: Date.now() });
}

// â”€â”€ Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // Return cached result if available (avoids redundant Gemini calls)
  const cacheKey = targetUrl.toLowerCase().replace(/\/+$/, '');
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`Cache hit: ${cacheKey}`);
    return res.status(200).json({ ...cached, _cached: true });
  }

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

  // Domain override always wins â€” even if scraping was blocked
  if (override) {
    analysisStatus = 'ok';
    fetchedOk = true;
  }

  // No override and blocked/failed â†' try Gemini with domain-only signal, else ask user
  if (!override && (analysisStatus === 'blocked' || analysisStatus === 'failed')) {
    const geminiRaw = await callAI(extracted, targetUrl, analysisStatus);
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
    // No Gemini key or Gemini failed â€” ask user to pick category manually
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

  // â”€â”€ Classify: try Gemini first, fall back to rules-based â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let primary, categories, summary, questions, questionsRich = [], customerType, aiAssisted = false;
  let aiExtras = {}, weakEvidence = false;
  let detectedNiche = null, productsFound = [], productsStructured = [];
  let customerChannels = [], publicSignals = [], visibilityGaps = [];
  let organisationName = '', locationSignals = null;

  if (override) {
    ({ primary, categories } = override);
    const geminiRaw = await callAI(extracted, targetUrl, 'ok');
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
      const kwNiche = detectNicheFromText(extracted);
      if (geminiRaw?._error) {
        aiExtras = { geminiError: geminiRaw._error, geminiErrorDetail: geminiRaw._errorDetail || '', rateLimitFallback: true };
        questions = buildQuestions(categories, kwNiche); questionsRich = questions.map(q => ({ question: q, search_intent: '' }));
      } else {
        questions = buildQuestions(categories, kwNiche); questionsRich = questions.map(q => ({ question: q, search_intent: '' }));
      }
    }
  } else {
    const geminiRaw = await callAI(extracted, targetUrl, analysisStatus);
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
      const kwNiche = detectNicheFromText(extracted);
      if (geminiRaw?._error) {
        aiExtras = { geminiError: geminiRaw._error, geminiErrorDetail: geminiRaw._errorDetail || '', rateLimitFallback: true };
        questions = buildQuestions(categories, kwNiche); questionsRich = questions.map(q => ({ question: q, search_intent: '' }));
      } else {
        questions = buildQuestions(categories, kwNiche); questionsRich = questions.map(q => ({ question: q, search_intent: '' }));
      }
    }
  }

  const displayTitle = organisationName || brandName || extracted.title || extracted.ogTitle || '';
  const riskNarrative = buildRiskNarrative(displayTitle, primary, categories);
  const categoryLabels = categories.map(c => ({
    key: c, label: CATEGORY_DEFS[c]?.label || c, primary: c === primary,
  }));

  const responseData = {
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
  };

  // Cache successful AI-assisted results to avoid redundant Gemini calls
  if (aiAssisted && !weakEvidence) {
    cacheSet(cacheKey, responseData);
  }

  res.status(200).json(responseData);
};
