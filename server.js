const path = require("path");
const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 8080;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const RESOLVE_CACHE_MS = 5 * 60 * 1000;

const resolvedUrlCache = new Map();
let browserPromise = null;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname)));

function safeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripActiveContent(html) {
  let out = String(html || "");
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
  out = out.replace(/<meta[^>]+http-equiv=["']X-Frame-Options["'][^>]*>/gi, "");
  out = out.replace(/<base[^>]*>/gi, "");
  return out;
}

function injectBaseAndBanner(html, sourceUrl) {
  const clean = stripActiveContent(html);
  const baseTag = `<base href="${safeHtml(sourceUrl)}">`;
  const banner = `
    <div style="position:sticky;top:0;z-index:2147483647;background:#111;color:#eee;padding:10px 12px;font:13px/1.35 system-ui,sans-serif;border-bottom:1px solid #333">
      נטען מתוך תוצאה ראשונה:
      <a href="${safeHtml(sourceUrl)}" rel="noreferrer" style="color:#55d48c;text-decoration:none">${safeHtml(sourceUrl)}</a>
    </div>
  `;

  if (/<head[^>]*>/i.test(clean)) {
    let out = clean.replace(/<head[^>]*>/i, (match) => `${match}${baseTag}`);
    if (/<body[^>]*>/i.test(out)) {
      out = out.replace(/<body[^>]*>/i, (match) => `${match}${banner}`);
    }
    return out;
  }

  return `<!doctype html><html><head>${baseTag}</head><body>${banner}${clean}</body></html>`;
}

function isAllowedResultUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (
      host.includes("google.") ||
      host.includes("bing.") ||
      host.includes("duckduckgo.") ||
      host.includes("youtube.") ||
      host.includes("youtu.be") ||
      host.includes("facebook.") ||
      host.includes("instagram.") ||
      host.includes("tiktok.")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function decodeBingTrackingUrl(href) {
  if (!href) return "";
  try {
    const parsed = new URL(href);
    if (!parsed.hostname.includes("bing.com") || !parsed.pathname.startsWith("/ck/")) {
      return href;
    }
    let payload = parsed.searchParams.get("u") || "";
    if (!payload) return "";
    if (payload.startsWith("a1")) payload = payload.slice(2);
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    return decoded || "";
  } catch {
    return "";
  }
}

function decodeGoogleResultUrl(href) {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (!href.startsWith("/url?")) return "";
  try {
    const parsed = new URL(`https://www.google.com${href}`);
    return parsed.searchParams.get("q") || "";
  } catch {
    return "";
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }
  return browserPromise;
}

async function withContext(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "en-US",
    userAgent: BROWSER_USER_AGENT,
    viewport: { width: 1366, height: 900 },
  });
  try {
    return await fn(context);
  } finally {
    await context.close();
  }
}

async function maybeHandleGoogleConsent(page) {
  const selectors = [
    "button:has-text('I agree')",
    "button:has-text('Accept all')",
    "button:has-text('Reject all')",
  ];

  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 1000 }).catch(() => {});
      return;
    }
  }
}

async function resolveFromGoogle(page, query) {
  const googleUrl = `https://www.google.com/search?hl=en&gl=us&num=10&q=${encodeURIComponent(query)}`;
  await page.goto(googleUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await maybeHandleGoogleConsent(page);
  await page.waitForTimeout(700);
  const links = page.locator("a:has(h3)");
  const count = Math.min(await links.count().catch(() => 0), 10);
  for (let i = 0; i < count; i++) {
    const raw = await links.nth(i).getAttribute("href").catch(() => "");
    const decoded = decodeGoogleResultUrl(raw || "");
    if (decoded) return decoded;
  }
  return "";
}

async function resolveFromDuckDuckGo(page, query) {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);

  const href = await page.evaluate(() => {
    const selectors = [
      "article h2 a",
      "a[data-testid='result-title-a']",
      ".result__a",
    ];
    for (const selector of selectors) {
      const a = document.querySelector(selector);
      if (!a) continue;
      let href = a.getAttribute("href") || "";
      if (!href) continue;
      if (href.startsWith("/l/?")) {
        try {
          const u = new URL(`https://duckduckgo.com${href}`);
          href = decodeURIComponent(u.searchParams.get("uddg") || "");
        } catch {
          href = "";
        }
      }
      if (/^https?:\/\//i.test(href)) return href;
    }
    return "";
  });

  return href;
}

async function resolveFromBing(page, query) {
  const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  await page.goto(bingUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(700);
  const links = page.locator("li.b_algo h2 a");
  await links.first().waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
  const count = Math.min(await links.count().catch(() => 0), 10);
  for (let i = 0; i < count; i++) {
    const raw = await links.nth(i).getAttribute("href").catch(() => "");
    const decoded = decodeBingTrackingUrl(raw || "");
    if (decoded) return decoded;
  }
  return "";
}

async function resolveFirstResultUrl(query) {
  const cacheKey = query.trim().toLowerCase();
  const cached = resolvedUrlCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESOLVE_CACHE_MS) {
    return cached.url;
  }

  const url = await withContext(async (context) => {
    async function tryProvider(providerFn) {
      const page = await context.newPage();
      try {
        return await providerFn(page);
      } catch {
        return "";
      } finally {
        await page.close().catch(() => {});
      }
    }

    let href = await tryProvider((page) => resolveFromGoogle(page, query));
    if (!isAllowedResultUrl(href)) {
      href = await tryProvider((page) => resolveFromBing(page, query));
    }
    if (!isAllowedResultUrl(href)) {
      href = await tryProvider((page) => resolveFromDuckDuckGo(page, query));
    }
    if (!isAllowedResultUrl(href)) {
      throw new Error("Could not resolve first result URL");
    }
    return href;
  });

  resolvedUrlCache.set(cacheKey, { url, ts: Date.now() });
  return url;
}

async function fetchTargetHtml(targetUrl) {
  return withContext(async (context) => {
    const page = await context.newPage();
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1200);
      return await page.content();
    } finally {
      await page.close().catch(() => {});
    }
  });
}

function prettyErrorMessage(error) {
  const msg = String(error && error.message ? error.message : error || "");
  if (msg.includes("Executable doesn't exist")) {
    return "Playwright browser missing. Run: npx playwright install chromium";
  }
  return msg || "Unknown error";
}

app.get("/api/health", (_, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, engine: "playwright", ts: Date.now() });
});

app.get("/api/chords/resolve", async (req, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) {
    res.status(400).json({ error: "Missing query" });
    return;
  }

  try {
    const firstResultUrl = await resolveFirstResultUrl(query);
    res.setHeader("Cache-Control", "no-store");
    res.json({ query, firstResultUrl });
  } catch (error) {
    res.status(502).json({ query, error: prettyErrorMessage(error) });
  }
});

app.get("/api/chords/embedded", async (req, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) {
    res.status(400).type("text/html; charset=utf-8").send("<h1>Missing query</h1>");
    return;
  }

  try {
    const firstResultUrl = await resolveFirstResultUrl(query);
    const html = await fetchTargetHtml(firstResultUrl);
    const embedded = injectBaseAndBanner(html, firstResultUrl);
    res.setHeader("Cache-Control", "no-store");
    res.type("text/html; charset=utf-8").send(embedded);
  } catch (error) {
    const message = safeHtml(prettyErrorMessage(error));
    res.status(502).type("text/html; charset=utf-8").send(`
      <!doctype html>
      <html lang="he" dir="rtl">
      <head><meta charset="utf-8"><title>Chords Load Error</title></head>
      <body style="font-family:system-ui,sans-serif;background:#111;color:#eee;padding:20px">
        <h2>לא הצלחתי לטעון את האתר בתוך האפליקציה</h2>
        <p>${message}</p>
      </body>
      </html>
    `);
  }
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server ready on http://localhost:${PORT}`);
});

async function shutdown() {
  try {
    const browser = await browserPromise;
    if (browser) await browser.close();
  } catch {
    // ignore
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
