const path = require("path");
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 8080;

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

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

function isHttpUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

function isSearchEngineUrl(url) {
  if (!isHttpUrl(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith("google.com") ||
      host.endsWith("bing.com") ||
      host.endsWith("duckduckgo.com")
    );
  } catch {
    return false;
  }
}

function isDisallowedResultUrl(url) {
  if (!isHttpUrl(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("youtube.com") ||
      host.includes("youtu.be") ||
      host.includes("facebook.com") ||
      host.includes("instagram.com") ||
      host.includes("tiktok.com") ||
      host.includes("gstatic.com") ||
      host.includes("googleusercontent.com")
    );
  } catch {
    return true;
  }
}

function decodeGoogleHref(href) {
  if (!href) return "";
  if (isHttpUrl(href)) return href;
  if (!href.startsWith("/url?")) return "";

  const url = new URL(`https://www.google.com${href}`);
  return url.searchParams.get("q") || "";
}

function findGoogleFirstResult(html) {
  const $ = cheerio.load(html);

  const candidates = [];
  $("#search a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const hasHeading = $(el).find("h3").length > 0;
    if (!hasHeading) return;
    candidates.push(href);
  });

  for (const href of candidates) {
    const normalized = decodeGoogleHref(href);
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
      return normalized;
    }
  }

  return "";
}

function decodeBingHref(href) {
  if (!href) return "";
  if (isHttpUrl(href)) {
    try {
      const url = new URL(href);
      if (url.hostname !== "www.bing.com" || !url.pathname.startsWith("/ck/")) {
        return href;
      }

      const encoded = url.searchParams.get("u") || "";
      if (!encoded) return "";

      let payload = encoded;
      if (payload.startsWith("a1")) payload = payload.slice(2);
      payload = payload.replace(/-/g, "+").replace(/_/g, "/");
      while (payload.length % 4 !== 0) payload += "=";

      const decoded = Buffer.from(payload, "base64").toString("utf8");
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) return decoded;
    } catch {
      return "";
    }
  }
  return "";
}

function decodeDuckDuckGoHref(href) {
  if (!href) return "";
  if (isHttpUrl(href)) {
    try {
      const parsed = new URL(href);
      if (!parsed.hostname.includes("duckduckgo.com")) return href;
      const uddg = parsed.searchParams.get("uddg") || "";
      return decodeURIComponent(uddg);
    } catch {
      return href;
    }
  }
  if (href.startsWith("/l/?")) {
    const parsed = new URL(`https://duckduckgo.com${href}`);
    const uddg = parsed.searchParams.get("uddg") || "";
    return decodeURIComponent(uddg);
  }
  return "";
}

function extractResultLinksFromJinaMarkdown(markdown, limit = 8) {
  const out = [];
  const seen = new Set();
  const lines = String(markdown || "").split("\n");

  for (const line of lines) {
    if (!line.startsWith("[### ")) continue;
    const match = line.match(/\]\((https?:\/\/[^)]+)\)$/);
    if (!match) continue;
    const candidate = match[1];
    if (isHttpUrl(candidate) && !isSearchEngineUrl(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
      if (out.length >= limit) return out;
    }
  }

  const allLinks = String(markdown || "").match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g) || [];
  for (const token of allLinks) {
    const match = token.match(/\((https?:\/\/[^)]+)\)/);
    if (!match) continue;
    const candidate = match[1];
    if (isHttpUrl(candidate) && !isSearchEngineUrl(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

function findBingFirstResult(html) {
  const $ = cheerio.load(html);
  const anchors = $("li.b_algo h2 a[href]");

  for (const el of anchors.toArray()) {
    const href = $(el).attr("href") || "";
    const resolved = decodeBingHref(href);
    if (resolved) return resolved;
  }

  return "";
}

function findDuckDuckGoFirstResult(html) {
  const $ = cheerio.load(html);
  const href = $(".result__a").first().attr("href") || $("a[data-testid='result-title-a']").first().attr("href") || "";
  const decoded = decodeDuckDuckGoHref(href);
  if (decoded.startsWith("http://") || decoded.startsWith("https://")) return decoded;
  return "";
}

function pushUnique(candidates, candidate) {
  if (!isHttpUrl(candidate)) return;
  if (isSearchEngineUrl(candidate)) return;
  if (isDisallowedResultUrl(candidate)) return;
  if (!candidates.includes(candidate)) candidates.push(candidate);
}

async function resolveCandidateUrls(rawQuery) {
  const query = rawQuery.trim();
  if (!query) throw new Error("Missing query");
  const candidates = [];

  const googleUrl = `https://www.google.com/search?hl=en&gl=us&num=10&q=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(googleUrl, {
      timeout: 12000,
      headers: HTTP_HEADERS,
      validateStatus: () => true,
    });
    if (res.status >= 200 && res.status < 300) {
      const fromGoogle = findGoogleFirstResult(res.data || "");
      pushUnique(candidates, fromGoogle);
    }
  } catch {
    // Continue to fallback search providers.
  }

  const jinaGoogleUrl = `https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(query)}`;
  try {
    const jinaRes = await axios.get(jinaGoogleUrl, {
      timeout: 18000,
      headers: HTTP_HEADERS,
      validateStatus: () => true,
    });
    if (jinaRes.status >= 200 && jinaRes.status < 300) {
      const fromJina = extractResultLinksFromJinaMarkdown(jinaRes.data || "");
      fromJina.forEach((url) => pushUnique(candidates, url));
    }
  } catch {
    // Continue to fallback.
  }

  const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  try {
    const bingRes = await axios.get(bingUrl, {
      timeout: 12000,
      headers: HTTP_HEADERS,
      validateStatus: () => true,
    });
    if (bingRes.status >= 200 && bingRes.status < 300) {
      const fromBing = findBingFirstResult(bingRes.data || "");
      pushUnique(candidates, fromBing);
    }
  } catch {
    // Continue to fallback.
  }

  const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const ddgRes = await axios.get(ddgUrl, {
      timeout: 12000,
      headers: HTTP_HEADERS,
      validateStatus: () => true,
    });
    if (ddgRes.status >= 200 && ddgRes.status < 300) {
      const fromDdg = findDuckDuckGoFirstResult(ddgRes.data || "");
      pushUnique(candidates, fromDdg);
    }
  } catch {
    // Ignore.
  }

  if (!candidates.length) throw new Error("Could not resolve first search result");
  return candidates;
}

async function resolveFirstResultUrl(rawQuery) {
  const candidates = await resolveCandidateUrls(rawQuery);
  return candidates[0];
}

function removeScriptsAndMeta(html) {
  let out = html || "";
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
  out = out.replace(/<meta[^>]+http-equiv=["']X-Frame-Options["'][^>]*>/gi, "");
  out = out.replace(/<base[^>]*>/gi, "");
  return out;
}

function safeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectBaseAndBanner(html, sourceUrl) {
  const clean = removeScriptsAndMeta(html);
  const baseTag = `<base href="${safeHtml(sourceUrl)}">`;
  const banner = `
    <div style="position:sticky;top:0;z-index:2147483647;background:#111;color:#eee;padding:10px 12px;font:13px/1.35 system-ui,sans-serif;border-bottom:1px solid #333">
      נטען מתוך תוצאה ראשונה:
      <a href="${safeHtml(sourceUrl)}" rel="noreferrer" style="color:#55d48c;text-decoration:none">${safeHtml(sourceUrl)}</a>
    </div>
  `;

  if (/<head[^>]*>/i.test(clean)) {
    let out = clean.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
    if (/<body[^>]*>/i.test(out)) {
      out = out.replace(/<body[^>]*>/i, (m) => `${m}${banner}`);
    }
    return out;
  }

  return `<!doctype html><html><head>${baseTag}</head><body>${banner}${clean}</body></html>`;
}

async function fetchPageHtml(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    headers: HTTP_HEADERS,
    responseType: "text",
    validateStatus: () => true,
  });

  const type = String(res.headers["content-type"] || "").toLowerCase();
  if (!(res.status >= 200 && res.status < 400)) {
    throw new Error(`Target site returned ${res.status}`);
  }
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
    throw new Error(`Unsupported target content type: ${type || "unknown"}`);
  }

  return String(res.data || "");
}

async function fetchViaJinaAsHtml(url) {
  const mirrorUrl = `https://r.jina.ai/http://${String(url).replace(/^https?:\/\//, "")}`;
  const res = await axios.get(mirrorUrl, {
    timeout: 20000,
    headers: HTTP_HEADERS,
    validateStatus: () => true,
  });

  if (!(res.status >= 200 && res.status < 300)) {
    throw new Error(`Jina mirror failed with ${res.status}`);
  }

  const md = String(res.data || "");
  const escaped = safeHtml(md).replace(/\n/g, "<br>");
  return `
    <!doctype html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="utf-8">
      <title>Chords Snapshot</title>
      <style>
        body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:16px;line-height:1.45}
        a{color:#55d48c}
        .note{position:sticky;top:0;background:#161616;border-bottom:1px solid #333;padding:10px 12px;margin:-16px -16px 16px}
      </style>
    </head>
    <body>
      <div class="note">נטען מצב Snapshot (scraping) מתוך: <a href="${safeHtml(url)}" rel="noreferrer">${safeHtml(url)}</a></div>
      <div>${escaped}</div>
    </body>
    </html>
  `;
}

app.get("/api/chords/embedded", async (req, res) => {
  const rawQuery = String(req.query.query || "").trim();
  if (!rawQuery) {
    res.status(400).type("text/html; charset=utf-8").send("<h1>Missing query</h1>");
    return;
  }

  try {
    const candidates = await resolveCandidateUrls(rawQuery);
    let selectedUrl = "";
    let pageHtml = "";
    let lastError = null;

    for (const candidate of candidates.slice(0, 5)) {
      try {
        pageHtml = await fetchPageHtml(candidate);
        selectedUrl = candidate;
        break;
      } catch (directError) {
        try {
          pageHtml = await fetchViaJinaAsHtml(candidate);
          selectedUrl = candidate;
          break;
        } catch (jinaError) {
          lastError = jinaError || directError;
        }
      }
    }

    if (!selectedUrl || !pageHtml) {
      const err = lastError && lastError.message ? lastError.message : "Could not load any top result";
      throw new Error(err);
    }

    const embedded = injectBaseAndBanner(pageHtml, selectedUrl);
    res.setHeader("Cache-Control", "no-store");
    res.type("text/html; charset=utf-8").send(embedded);
  } catch (error) {
    const message = safeHtml(error && error.message ? error.message : "Unknown error");
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

app.get("/api/chords/resolve", async (req, res) => {
  const rawQuery = String(req.query.query || "").trim();
  if (!rawQuery) {
    res.status(400).json({ error: "Missing query" });
    return;
  }

  try {
    const candidates = await resolveCandidateUrls(rawQuery);
    const firstResultUrl = candidates[0];
    res.setHeader("Cache-Control", "no-store");
    res.json({ query: rawQuery, firstResultUrl, candidates: candidates.slice(0, 5) });
  } catch (error) {
    res.status(502).json({
      query: rawQuery,
      error: error && error.message ? error.message : "Unknown error",
    });
  }
});

app.get("/api/health", (_, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ts: Date.now() });
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server ready on http://localhost:${PORT}`);
});
