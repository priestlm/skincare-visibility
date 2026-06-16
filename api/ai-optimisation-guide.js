// Distilled reference from Google's AI Optimization Guide
// Source: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
// Used to ground visibility gap detection and action recommendations in report generation.

const AI_OPTIMISATION_GUIDE = `
## Google's AI Optimisation Guide — Key Principles

### How AI search features work
- Google's generative AI features (AI Overviews, AI Mode) use Retrieval-Augmented Generation (RAG): they retrieve indexed pages and use them to ground answers.
- Query fan-out: the AI generates related sub-queries to pull in more results — so a brand must appear across a range of related question types, not just one.
- A page MUST be indexed and eligible to appear in Google Search with a snippet to be eligible for generative AI features.

### What actually improves AI visibility

**1. Unique, non-commodity content**
- First-hand reviews, original insights, and expertise signal trust to AI systems.
- Avoid restating common knowledge — AI ignores thin or recycled content.
- Clear structure (headings, sections) helps AI parse and cite your content.
- High-quality images and video reinforce relevance signals.

**2. Technical foundations (indexing prerequisites)**
- Pages must be crawlable, publicly accessible, and indexed.
- Semantic HTML improves accessibility and AI comprehension.
- Follow JavaScript SEO best practices — JS-rendered content must be crawlable.
- Reduce duplicate content across the site.
- Optimise page experience (Core Web Vitals, mobile, speed).

**3. Business and local signals**
- Google Business Profile with accurate name, address, phone, hours, categories.
- Schema markup: LocalBusiness, Product, FAQ, Review, BreadcrumbList.
- Google Merchant Center feeds for product visibility.
- Customer reviews on Google — AI cites review sentiment directly.

**4. Content that directly answers buyer questions**
- Write FAQ pages that match how buyers ask questions to AI assistants (conversational, plain English).
- Cover the full buyer journey: discovery → comparison → purchase → usage.
- Address "is X right for me?" and "X vs Y" queries directly.
- Named stockists, delivery areas, and availability details help AI answer "where can I buy" queries.

### What does NOT help (common misconceptions)
- Creating AI-specific text files, llms.txt, or Markdown files — Google Search ignores them.
- Fragmenting content into tiny chunks — Google understands full-page context.
- Rewriting content to sound more "AI friendly" — AI understands synonyms naturally.
- Paying for or faking product mentions across the web.
- Adding structured data for its own sake — it helps rich results, not AI visibility directly.

### Priority action order (per Google)
1. Fix crawlability and indexing issues first.
2. Develop expert-led, unique content serving genuine user needs.
3. Structure content with clear headings, sections, and FAQ format.
4. Maintain accurate business profiles and local signals.
5. Ignore gimmicky "AEO" or "GEO" optimisation tactics.
`;

module.exports = { AI_OPTIMISATION_GUIDE };
