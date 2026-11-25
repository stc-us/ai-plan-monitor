// Daily check checklist for the AI Plan Price Monitor.
// The vendors' pricing pages are the source of truth; some offers
// (Google AI Pro BF) require a signed-in account, so this script does
// not scrape prices — it prints what to re-check, and the agent/manual
// step updates data/prices.json, following the watermark rule:
//  - apply a result only if its check time is newer than the watermark
//  - changed = report + update baseline AFTER the report is confirmed sent
//  - unchanged = silent, no write
//  - unknown = check failed / no data, record "not verified", never "unchanged"
const PAGES = [
  "https://chatgpt.com/pricing/ — ChatGPT Free/Go/Plus/Pro/Business, Codex inclusion, any promo",
  "https://one.google.com/ai — Google AI Plus/Pro/Ultra, BF annual offer (signed-in)",
  "https://workspace.google.com/pricing — Workspace Starter/Standard/Plus, Gemini limits",
  "https://claude.com/pricing — Claude Pro/Max/Ultra",
  "https://www.perplexity.ai/pro — Perplexity Pro/Max, +$40 credits bonus",
  "https://www.microsoft.com/en-us/store/b/black-friday — Copilot / M365 Premium",
];
console.log("AI Plan Price Monitor — daily check, " + new Date().toISOString().slice(0, 10));
for (const p of PAGES) console.log(" - " + p);
console.log("Then: edit data/prices.json, commit, push — Cloudflare Pages redeploys automatically.");
