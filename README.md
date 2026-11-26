# AI Plan Price Monitor

Monitor price / plan / coupon changes by country for AI subscriptions:
ChatGPT Free / Go / Plus / Pro / Business, Google AI Plus / Pro / Ultra,
Google Workspace with Gemini (Starter / Standard / Plus / Enterprise),
Claude Pro / Max / Ultra, Perplexity Pro, Microsoft 365 Premium (Copilot).

Live data is in `data/prices.json` — one file, one source of truth.
The site is static (`index.html` + `data/prices.json`) and reads that file
in the browser, so updating the monitor is editing one JSON file.

## Baseline (24 Nov 2026)

- Only genuine Black Friday 2026 deal: Google AI Pro annual
  $199.99/yr → $99.99/yr first year. Early access 20–26 Nov for existing
  Google AI / Google One subscribers; general offer from 27 Nov.
  Google AI Plus annual $99.99 → $49.99/yr is a Slickdeals user report,
  not confirmed on Google's own page.
- No official BF sale: ChatGPT/Codex, Claude, Perplexity.
- Cheapest: ChatGPT Go Indonesia IDR 75,000 ~$4.12/mo; ChatGPT Plus
  Philippines ₱999 ~$15.63/mo; Google AI Plus Bolivia BOB 34.99 ~$2.99/mo
  (web); Google AI Pro Bolivia Bs 139.99 ~$11.97/mo (web); Claude Pro
  Pakistan PKR 4,900 ~$17.72/mo.
- Turkey Google AI Pro: use TRY 869.99 ~$17.20. The TRY 539.99 listing
  (~$10.70) is unresolved — do not budget on it.
- Workspace Gemini is bundled in the seat price since Jan 2025, per named
  user, not concurrent use. US: Starter $7, Standard $14, Plus $22
  (annual, per user/mo). Starter Gemini is limited (Gmail + Vids only,
  32k context); Standard/Plus get Pro model, 1M context, Gemini across
  Docs/Sheets/Slides/Drive/Meet/Chat. Argon is NOT in Workspace — it
  needs the AI Expanded Access add-on.

## Rules (same hardening as the VPS monitor)

- Price follows account/payment country, not IP. A foreign Visa does not
  unlock another country's price. Never recommend VPN / mismatched
  billing evasion.
- Verify a deal on the provider's own page or a dated official
  announcement before reporting it live. Coupon sites alone do not count.
- Three states: changed / unchanged / unknown. A failed check is
  "not verified", never "unchanged".
- Update `data/prices.json` only after a change report is confirmed sent,
  and only if the check time is newer than that provider's watermark.

## Deploy — Cloudflare Pages + GitHub

1. Create a GitHub repo, e.g. `ai-plan-monitor`, push this folder.
2. In Cloudflare: Workers & Pages → Create → Pages → Connect to Git.
   Pick the repo, framework preset: None / Static, build command: (empty),
   build output directory: `/` (root — `index.html` is at the root).
3. Or with Wrangler (see `wrangler.toml`):
   `npx wrangler pages deploy . --project-name ai-plan-monitor`
4. Custom domain (optional): Pages → Custom domains → add yours.
   Cloudflare Pages hosting is free for this static site.

## Daily update

Run `node scripts/crawl.mjs` — deterministic crawler, no dependencies,
no LLM calls. It fetches the official pricing pages, extracts price
signals with simple parsing, compares them against `data/prices.json`,
and writes a per-provider report (changed / unchanged / unknown) to
stdout and to `scripts/crawl-report.json`. Google AI is always reported
as unknown/manual-check: the Black Friday annual offer needs a signed-in
account, so it is never scraped or guessed. The crawler never writes to
`data/prices.json` — updating the baseline stays a separate, confirmed
step. `node scripts/check.mjs` is still there as the manual checklist.
Then edit `data/prices.json`, commit, push — Pages redeploys automatically.

Note: several pricing pages are JS-rendered, so the crawler honestly
reports them as unknown ("not verified") when no price signal is found
in the fetched HTML, rather than claiming they are unchanged.

## Languages (i18n)

The site supports English, Chinese, Japanese and Spanish. All UI strings
live in `data/i18n/{en,zh,ja,es}.json` (same key set in every file);
plan/deal note text is translated there too, keyed by plan/deal, while
prices, currency amounts and country names stay as data in
`data/prices.json` and are never translated. The header switcher
(EN / 中文 / 日本語 / Español) detects the browser language on first
load, falls back to English, persists the choice in localStorage, and
supports `?lang=zh` (etc.). No LLM is needed for the refresh or for
i18n — both are deterministic; an LLM is only useful as an optional
reviewer for new translations or for judging a changed price.

## Files

- `index.html` — the site (deals, cheapest-country explorer, plan tables)
- `data/prices.json` — all prices, deals, country tables
- `data/i18n/{en,zh,ja,es}.json` — UI translations (English, Chinese, Japanese, Spanish)
- `wrangler.toml` — Cloudflare Pages project config
- `.github/workflows/deploy.yml` — deploy on push to main (needs
  Cloudflare API token + Account ID as GitHub secrets)
- `scripts/check.mjs` — daily check checklist
- `scripts/crawl.mjs` — deterministic daily crawler (no deps, no LLM);
  writes its report to `scripts/crawl-report.json`
