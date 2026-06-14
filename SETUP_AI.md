# SETUP_AI.md — Adding AI Classification (Gemini)

This prototype uses keyword-based classification by default. To enable AI-assisted classification via Google Gemini 1.5 Flash (free tier), add a `GEMINI_API_KEY` environment variable in Vercel.

## Step 1 — Get a free Gemini API key

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with a Google account
3. Click **Create API key**
4. Copy the key (starts with `AIza...`)

The Gemini 1.5 Flash model is free on the Developer tier with generous rate limits (15 requests/minute, 1 million tokens/day as of mid-2025).

## Step 2 — Add the key in Vercel

1. Open your project at **https://vercel.com/dashboard**
2. Select **product-visibility** (or your project name)
3. Click **Settings** → **Environment Variables**
4. Click **Add New**
   - **Key**: `GEMINI_API_KEY`
   - **Value**: paste your key
   - **Environments**: tick Production, Preview, Development
5. Click **Save**
6. Go to **Deployments** → click the three-dot menu on the latest deployment → **Redeploy**

The next deployment will pick up the key automatically.

## Step 3 — Verify

Analyse any website. If AI classification is active, the Formspree submission will include `ai_assisted: true` in the hidden fields. You can also check the Vercel function logs under **Functions** in your project dashboard.

## Fallback behaviour

If `GEMINI_API_KEY` is not set, or if the Gemini API call fails for any reason, the prototype silently falls back to keyword-based classification. No errors are shown to the user.

## Security notes

- The API key is stored as a Vercel environment variable and is **never exposed to the browser**.
- The key is only used inside the serverless function (`api/analyse.js`).
- Do not commit the key to Git or add it to `index.html`.

## What the AI improves

| Signal | Without AI | With AI |
|---|---|---|
| Brand name | From page title | AI-inferred from context |
| Business summary | Meta description / first heading | Natural-language description |
| Category | Keyword scoring | Semantic understanding |
| Shopping questions | Template per category | Brand-specific, contextual |
| Blocked sites | Falls back to manual picker | AI uses domain knowledge to classify |
