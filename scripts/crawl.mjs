// Daily-refresh crawler for the AI Plan Price Monitor.
// Node, no dependencies, no LLM calls, fully deterministic.
// Fetches the official pricing pages, extracts price signals with simple
// parsing, and compares them against the baseline in data/prices.json.
//
// Output: a per-provider report on stdout AND a JSON file
// (default: scripts/crawl-report.json, override with --out <path>).
// Status per provider: changed / unchanged / unknown.
//   - unknown = fetch failed, page empty/JS-rendered, or no price signal
//     found. Unknown is NEVER reported as unchanged.
//   - Google AI (one.google.com/ai) is ALWAYS unknown: the Black Friday
//     annual offer requires a signed-in account, so it must be checked
//     manually. This script never scrapes or guesses it.
// This script NEVER writes to data/prices.json. Updating the baseline
// stays a separate, confirmed step (see README.md / scripts/check.mjs).
//
// Usage: node scripts/crawl.mjs [--out <path>] [--provider <name>]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "data/prices.json");
const DEFAULT_OUT = join(ROOT, "scripts", "crawl-report.json");
const TIMEOUT_MS = 20000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 AI-Plan-Price-Monitor/1.0 (daily price check)";

// Baseline US prices to look for on each official page.
// `token` is the exact price string; `keyword` is the plan name to look
// for nearby when a token is missing.
const PROVIDERS = [
  {
    name: "chatgpt",
    url: "https://chatgpt.com/pricing/",
    expected: [
      { label: "Free", token: "$0", keyword: "Free" },
      { label: "Go", token: "$8", keyword: "Go" },
      { label: "Plus", token: "$20", keyword: "Plus" },
      { label: "Pro", token: "$100", keyword: "Pro" },
      { label: "Business", token: "$25", keyword: "Business" },
    ],
  },
  {
    name: "google_ai",
    url: "https://one.google.com/ai",
    manual: true,
    manual_reason:
      "Black Friday annual offer requires a signed-in Google account; price is not visible to an anonymous fetch. Manual check required at one.google.com/settings.",
    expected: [],
  },
  {
    name: "workspace",
    url: "https://workspace.google.com/pricing",
    expected: [
      { label: "Business Starter", token: "$7", keyword: "Starter" },
      { label: "Business Standard", token: "$14", keyword: "Standard" },
      { label: "Business Plus", token: "$22", keyword: "Plus" },
    ],
  },
  {
    name: "claude",
    url: "https://claude.com/pricing",
    expected: [
      { label: "Pro", token: "$20", keyword: "Pro" },
      { label: "Max", token: "$100", keyword: "Max" },
      { label: "Ultra", token: "$200", keyword: "Ultra" },
    ],
  },
  {
    name: "perplexity",
    url: "https://www.perplexity.ai/pro",
    expected: [
      { label: "Pro monthly", token: "$20", keyword: "Pro" },
      { label: "Pro annual", token: "$17", keyword: "Pro" },
      { label: "Max", token: "$167", keyword: "Max" },
    ],
  },
  {
    name: "microsoft",
    url: "https://www.microsoft.com/en-us/store/b/black-friday",
    expected: [
      { label: "Microsoft 365 Premium", token: "$19.99", keyword: "Premium" },
    ],
  },
];

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

// Match "$20" but not "$200" or "$20.99" when looking for "$20".
function hasToken(text, token) {
  const escaped = token.replace("$", "\\$").replace(".", "\\.");
  return new RegExp(`${escaped}(?![0-9.])`).test(text);
}

function amountsNear(text, keyword, windowChars = 400) {
  const found = new Set();
  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const slice = text.slice(Math.max(0, m.index - windowChars), m.index + windowChars);
    for (const a of slice.match(/\$[\d,]+(?:\.\d{2})?/g) || []) found.add(a);
    if (found.size > 20) break;
  }
  return [...found];
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, finalUrl: res.url, body };
  } finally {
    clearTimeout(timer);
  }
}

async function checkProvider(p, checkedAt) {
  const result = {
    provider: p.name,
    url: p.url,
    status: "unknown",
    checked_at: checkedAt,
    http_status: null,
    bytes: 0,
    expected: [],
    found_amounts: [],
    evidence: "",
  };

  if (p.manual) {
    // Still record reachability, but never parse or infer a price.
    try {
      const r = await fetchPage(p.url);
      result.http_status = r.status;
      result.bytes = r.body.length;
      result.evidence = `Page reachable (HTTP ${r.status}), but ${p.manual_reason}`;
    } catch (e) {
      result.evidence = `Fetch failed (${e.message}), and ${p.manual_reason}`;
    }
    result.status = "unknown";
    return result;
  }

  let page;
  try {
    page = await fetchPage(p.url);
  } catch (e) {
    result.evidence = `Fetch failed: ${e.name === "AbortError" ? "timeout after 20s" : e.message}`;
    return result;
  }
  result.http_status = page.status;
  result.bytes = page.body.length;
  if (!page.ok) {
    result.evidence = `HTTP ${page.status} from ${page.finalUrl}`;
    return result;
  }
  const text = stripHtml(page.body);
  if (text.length < 500) {
    result.evidence = `Page returned only ${text.length} chars of text (likely a JS shell / bot check); no price signal.`;
    return result;
  }

  const missing = [];
  for (const exp of p.expected) {
    const found = hasToken(text, exp.token);
    result.expected.push({ ...exp, found });
    if (!found) missing.push(exp);
  }
  result.found_amounts = [...new Set(text.match(/\$[\d,]+(?:\.\d{2})?/g) || [])].slice(0, 30);

  if (missing.length === 0) {
    result.status = "unchanged";
    result.evidence = `All ${p.expected.length} baseline price tokens found on the page (${result.expected.map(e => e.token).join(", ")}).`;
    return result;
  }

  // Some baseline tokens missing: look for a different amount near the
  // plan name before calling it a change; otherwise it is unknown
  // (most pricing pages are JS-rendered, so absence proves nothing).
  const candidates = [];
  for (const exp of missing) {
    for (const amt of amountsNear(text, exp.keyword)) {
      if (!hasToken(amt + " ", exp.token)) candidates.push(`${exp.label}: ${amt} near "${exp.keyword}"`);
    }
  }
  if (candidates.length > 0) {
    result.status = "changed";
    result.evidence = `Baseline token(s) missing: ${missing.map(e => `${e.label} ${e.token}`).join(", ")}. Candidate replacement amounts found nearby: ${[...new Set(candidates)].join("; ")}. Verify on the page before updating the baseline.`;
  } else {
    result.status = "unknown";
    result.evidence = `Baseline token(s) missing (${missing.map(e => `${e.label} ${e.token}`).join(", ")}), but no replacement amount found near the plan names — page is likely JS-rendered, so this is "not verified", not a change.`;
  }
  return result;
}

function parseArgs(argv) {
  const out = { outPath: DEFAULT_OUT, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if (argv[i] === "--provider" && argv[i + 1]) out.only = argv[++i];
  }
  return out;
}

async function main() {
  const { outPath, only } = parseArgs(process.argv.slice(2));
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const checkedAt = new Date().toISOString();
  const providers = only ? PROVIDERS.filter(p => p.name === only) : PROVIDERS;
  if (only && providers.length === 0) {
    console.error(`Unknown provider: ${only}. Known: ${PROVIDERS.map(p => p.name).join(", ")}`);
    process.exitCode = 2;
    return;
  }

  console.log(`AI Plan Price Monitor — crawler, ${checkedAt}`);
  console.log(`Baseline last checked: ${baseline.meta?.last_checked} (data/prices.json is read-only for this script)`);
  console.log("");
  const results = [];
  for (const p of providers) {
    const r = await checkProvider(p, checkedAt);
    results.push(r);
    const icon = r.status === "unchanged" ? "✓" : r.status === "changed" ? "!" : "?";
    console.log(`[${icon}] ${r.provider} — ${r.status.toUpperCase()} — ${r.url}`);
    console.log(`    ${r.evidence}`);
  }

  const summary = {
    changed: results.filter(r => r.status === "changed").map(r => r.provider),
    unchanged: results.filter(r => r.status === "unchanged").map(r => r.provider),
    unknown: results.filter(r => r.status === "unknown").map(r => r.provider),
  };
  const report = { checked_at: checkedAt, baseline_last_checked: baseline.meta?.last_checked, summary, providers: results };
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log("");
  console.log(`Summary: ${summary.changed.length} changed, ${summary.unchanged.length} unchanged, ${summary.unknown.length} unknown.`);
  if (summary.changed.length) console.log(`Changed: ${summary.changed.join(", ")} — verify on the page before updating data/prices.json.`);
  if (summary.unknown.length) console.log(`Unknown (manual check needed): ${summary.unknown.join(", ")}.`);
  console.log(`Full report: ${outPath}`);
}

main().catch(e => {
  console.error("Crawler failed:", e.message);
  process.exitCode = 1;
});
