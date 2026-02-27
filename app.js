// Spotify → Chords (static site)
// No code edits needed: user enters Client ID in the UI once.
// Redirect URI is displayed on screen for copy/paste into Spotify app settings.

const LS = {
  clientId: "spch_client_id",
  apiBase: "spch_api_base",
  accessToken: "spch_access_token",
  refreshToken: "spch_refresh_token",
  expiresAt: "spch_expires_at",
  pkceVerifier: "spch_pkce_verifier",
  oauthState: "spch_oauth_state",
};

const SCOPES = ["user-read-currently-playing", "user-read-playback-state"];

const els = {
  redirectUri: document.getElementById("redirectUri"),
  copyRedirectBtn: document.getElementById("copyRedirectBtn"),
  clientIdInput: document.getElementById("clientIdInput"),
  saveClientIdBtn: document.getElementById("saveClientIdBtn"),
  apiBaseInput: document.getElementById("apiBaseInput"),
  saveApiBaseBtn: document.getElementById("saveApiBaseBtn"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authStatePill: document.getElementById("authStatePill"),
  cover: document.getElementById("cover"),
  title: document.getElementById("title"),
  artist: document.getElementById("artist"),
  status: document.getElementById("status"),
  chordsGoogle: document.getElementById("chordsGoogle"),
  spotifyOpen: document.getElementById("spotifyOpen"),
  chordsCard: document.getElementById("chordsCard"),
  chordsFrame: document.getElementById("chordsFrame"),
  chordsHint: document.getElementById("chordsHint"),
  closeChordsBtn: document.getElementById("closeChordsBtn"),
  debugLine: document.getElementById("debugLine"),
};

function baseDirUrl() {
  // Ensure we are always in the directory that holds index.html/callback.html
  const url = new URL(location.href);
  // If index.html explicitly present, strip it:
  url.pathname = url.pathname.replace(/index\.html$/i, "");
  // If ends without '/', ensure it ends with '/':
  if (!url.pathname.endsWith("/")) {
    // GitHub Pages often serves /repo/ and /repo/index.html; keep directory safe:
    url.pathname = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function redirectUri() {
  return `${baseDirUrl()}callback.html`;
}

function getClientId() {
  return localStorage.getItem(LS.clientId) || "";
}

function setClientId(id) {
  localStorage.setItem(LS.clientId, id.trim());
}

function getApiBase() {
  return (localStorage.getItem(LS.apiBase) || "").trim();
}

function setApiBase(url) {
  const clean = (url || "").trim().replace(/\/+$/, "");
  if (!clean) {
    localStorage.removeItem(LS.apiBase);
    return;
  }
  localStorage.setItem(LS.apiBase, clean);
}

function setTokens({ access_token, refresh_token, expires_in }) {
  if (access_token) localStorage.setItem(LS.accessToken, access_token);
  if (refresh_token) localStorage.setItem(LS.refreshToken, refresh_token);
  const expiresAt = Date.now() + (Number(expires_in || 3600) * 1000) - 5000;
  localStorage.setItem(LS.expiresAt, String(expiresAt));
}

function clearTokens() {
  localStorage.removeItem(LS.accessToken);
  localStorage.removeItem(LS.refreshToken);
  localStorage.removeItem(LS.expiresAt);
  localStorage.removeItem(LS.pkceVerifier);
  localStorage.removeItem(LS.oauthState);
}

function tokenExpired() {
  const t = localStorage.getItem(LS.accessToken);
  const exp = Number(localStorage.getItem(LS.expiresAt) || "0");
  if (!t) return true;
  return Date.now() > exp;
}

function getAccessToken() {
  return localStorage.getItem(LS.accessToken) || "";
}

function getRefreshToken() {
  return localStorage.getItem(LS.refreshToken) || "";
}

function setPill(state, text) {
  els.authStatePill.classList.remove("ok", "bad");
  if (state === "ok") els.authStatePill.classList.add("ok");
  if (state === "bad") els.authStatePill.classList.add("bad");
  els.authStatePill.textContent = text;
}

function setStatus(text) {
  els.status.textContent = text;
}

function setDebug(text) {
  els.debugLine.textContent = text || "";
}

function apiUrl(path) {
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const configured = getApiBase();

  // If a backend URL was configured explicitly, always use it.
  if (configured) {
    return `${configured.replace(/\/+$/, "")}/${cleanPath}`;
  }

  // Default to project-relative API path (works for /repo-name/ on GitHub Pages).
  return new URL(cleanPath, baseDirUrl()).toString();
}

function embeddedChordsUrl(query) {
  return apiUrl(`api/chords/embedded?query=${encodeURIComponent(query)}&t=${Date.now()}`);
}

const SEARCH_PROXY_BASE = "https://api.allorigins.win";
const BLOCKED_RESULT_HOSTS = [
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "ultimate-guitar.com",
  "e-chords.com",
  "khmerchords.com",
  "songsterr.com",
  "tabs.ultimate-guitar.com",
];
const SEARCH_ENGINE_HOSTS = [
  "bing.com",
  "google.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "yahoo.com",
  "yandex.com",
  "yandex.ru",
];
const FRAME_FRIENDLY_HOSTS = [
  "guitaretab.com",
  "chordsbase.com",
  "guitartabsexplorer.com",
  "ukulele-tabs.com",
  "playukulele.net",
  "cifraclub.com",
];
const CHORD_URL_HINTS = [
  "chord",
  "tab",
  "guitar",
  "ukulele",
  "cifra",
  "acord",
];

let frameFallbackTimer = null;
let backendHealthCache = { ok: null, checkedAt: 0 };

function safeHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function shouldSkipResult(url) {
  const host = safeHost(url);
  if (!host) return true;
  if (SEARCH_ENGINE_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
    return true;
  }
  return BLOCKED_RESULT_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

function bingSearchUrl(query) {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}

function searchProxyUrls(query) {
  const searchTextUrl = `https://r.jina.ai/http://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const encodedTarget = encodeURIComponent(searchTextUrl);
  return [
    `${SEARCH_PROXY_BASE}/raw?url=${encodedTarget}`,
    `${SEARCH_PROXY_BASE}/get?url=${encodedTarget}`,
  ];
}

function decodeBase64UrlUtf8(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) return "";

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function decodeBingTrackingUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("bing.com")) return rawUrl;
    if (!url.pathname.startsWith("/ck/a")) return rawUrl;

    const encoded = url.searchParams.get("u");
    if (!encoded) return rawUrl;

    const stripped = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
    const decoded = decodeBase64UrlUtf8(stripped);
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/^https?:$/i.test(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractCandidateLinksFromSearchText(text) {
  const source = String(text || "");
  const links = [];

  // Prefer numbered SERP lines when they exist.
  for (const match of source.matchAll(/^\s*\d+\.\s+\[[^\]]*]\((https?:\/\/[^\s)]+)\)/gim)) {
    links.push(match[1]);
  }

  // Fallback to any markdown/html link pattern.
  if (!links.length) {
    for (const match of source.matchAll(/\((https?:\/\/[^\s)]+)\)/gim)) {
      links.push(match[1]);
    }
    for (const match of source.matchAll(/href=["'](https?:\/\/[^"']+)["']/gim)) {
      links.push(match[1]);
    }
  }

  return links;
}

function hasChordHint(url) {
  const lowered = String(url || "").toLowerCase();
  return CHORD_URL_HINTS.some(h => lowered.includes(h));
}

function scoreResult(url, queryTokens) {
  const host = safeHost(url);
  if (!host) return -10000;
  if (shouldSkipResult(url)) return -10000;

  let score = 0;
  const lowered = url.toLowerCase();
  if (FRAME_FRIENDLY_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) score += 120;
  if (hasChordHint(url)) score += 35;

  for (const token of queryTokens) {
    if (lowered.includes(token)) score += 4;
  }

  return score;
}

function pickBestResult(query, candidates) {
  const tokens = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.replace(/[^a-z0-9א-ת]+/g, ""))
    .filter(token => token.length >= 3)
    .slice(0, 8);

  const seen = new Set();
  const ranked = [];

  for (let i = 0; i < candidates.length; i++) {
    const decoded = decodeBingTrackingUrl(candidates[i]);
    const normalized = normalizeUrl(decoded);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const score = scoreResult(normalized, tokens);
    if (score <= -1000) continue;
    ranked.push({ url: normalized, score, index: i });
  }

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.url || "";
}

async function fetchTextWithTimeout(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function unwrapProxyPayload(rawPayload) {
  const text = String(rawPayload || "").trim();
  if (!text) return "";
  if (!text.startsWith("{")) return text;

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.contents === "string") return parsed.contents;
  } catch {
    // ignore and fallback to the original text
  }
  return text;
}

async function resolveFirstResultWithoutBackend(query) {
  const searchQuery = `${query} guitar chords`;
  const proxyUrls = searchProxyUrls(searchQuery);
  let lastError = null;

  for (const proxyUrl of proxyUrls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const payload = await fetchTextWithTimeout(proxyUrl, 12000);
        const text = unwrapProxyPayload(payload);
        const links = extractCandidateLinksFromSearchText(text);
        const best = pickBestResult(searchQuery, links);
        if (best) return { mode: "direct", url: best };
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("No suitable result found");
}

function frameErrorHtml(title, details) {
  const safeTitle = String(title || "שגיאה").replace(/</g, "&lt;");
  const safeDetails = String(details || "").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>${safeTitle}</title></head>
<body style="margin:0;padding:18px;background:#111;color:#eee;font-family:system-ui,sans-serif;line-height:1.45">
  <h2 style="margin:0 0 10px">${safeTitle}</h2>
  <p style="margin:0 0 8px">${safeDetails}</p>
  <p style="margin:0">פתרון מהיר: נסה שוב, או הגדר URL של Backend בשדה ההגדרה למעלה.</p>
</body>
</html>`;
}

function showChordsInlineError(title, details) {
  if (!els.chordsCard || !els.chordsFrame) return;
  els.chordsCard.classList.add("open");
  els.chordsFrame.removeAttribute("src");
  els.chordsFrame.srcdoc = frameErrorHtml(title, details);
  if (els.chordsHint) {
    els.chordsHint.textContent = "לא הצלחתי לטעון תוצאה כרגע. עדכנתי הסבר בתוך התצוגה.";
  }
}

async function ensureBackendAvailable() {
  const now = Date.now();
  if (backendHealthCache.ok !== null && now - backendHealthCache.checkedAt < 15000) {
    return backendHealthCache.ok;
  }

  const healthUrl = apiUrl(`api/health?t=${now}`);
  let ok = false;
  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(healthUrl, {
      method: "GET",
      cache: "no-store",
      signal: ctl.signal,
    });
    clearTimeout(timeout);
    ok = res.ok;
  } catch {
    ok = false;
  }

  backendHealthCache = { ok, checkedAt: now };
  return ok;
}

function closeChordsViewer() {
  if (!els.chordsCard || !els.chordsFrame) return;
  els.chordsCard.classList.remove("open");
  els.chordsFrame.removeAttribute("src");
  els.chordsFrame.removeAttribute("srcdoc");
  if (els.chordsHint) {
    els.chordsHint.textContent = 'לחץ על "פתח אקורדים כאן" כדי לטעון את האתר הראשון בתוך האפליקציה.';
  }
  clearTimeout(frameFallbackTimer);
}

async function openChordsViewer(query) {
  if (!query) return;
  if (!els.chordsCard || !els.chordsFrame) return;

  els.chordsCard.classList.add("open");
  els.chordsFrame.removeAttribute("srcdoc");
  els.chordsFrame.removeAttribute("src");

  if (els.chordsHint) els.chordsHint.textContent = "מחפש תוצאה ראשונה…";

  const configuredBackend = getApiBase();
  if (configuredBackend) {
    const backendOk = await ensureBackendAvailable();
    if (backendOk) {
      els.chordsFrame.src = embeddedChordsUrl(query);
      if (els.chordsHint) els.chordsHint.textContent = "טוען אתר אקורדים דרך Backend…";
    } else if (els.chordsHint) {
      els.chordsHint.textContent = "Backend לא זמין כרגע, עובר למצב דפדפן בלבד…";
    }
  }

  if (!configuredBackend || !els.chordsFrame.src) {
    try {
      const resolved = await resolveFirstResultWithoutBackend(query);
      els.chordsFrame.src = resolved.url;
      if (els.chordsHint) {
        els.chordsHint.textContent = `טוען אתר אקורדים: ${safeHost(resolved.url)}`;
      }
    } catch (error) {
      const fallbackUrl = bingSearchUrl(`${query} guitar chords`);
      els.chordsFrame.src = fallbackUrl;
      if (els.chordsHint) {
        els.chordsHint.textContent = "החיפוש האוטומטי נכשל, נטענו תוצאות חיפוש בתוך האפליקציה.";
      }
      setDebug(`Search fallback: ${error?.message || String(error)}`);
    }
  }

  clearTimeout(frameFallbackTimer);
  frameFallbackTimer = setTimeout(() => {
    if (els.chordsHint) {
      els.chordsHint.textContent = "אם האתר לא מוצג טוב, נסה שוב או הגדר Backend ליציבות גבוהה יותר.";
    }
  }, 3500);
}

async function sha256(plain) {
  const enc = new TextEncoder();
  const data = enc.encode(plain);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}

async function startLogin() {
  const clientId = getClientId();
  if (!clientId) {
    setPill("bad", "חסר Client ID");
    alert("צריך להדביק Client ID פעם אחת בהגדרות למעלה.");
    return;
  }

  const verifier = randomString(64);
  localStorage.setItem(LS.pkceVerifier, verifier);

  const challenge = base64url(await sha256(verifier));
  const state = randomString(24);
  localStorage.setItem(LS.oauthState, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES.join(" "),
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function refreshAccessTokenIfNeeded() {
  if (!tokenExpired()) return true;

  const clientId = getClientId();
  const refreshToken = getRefreshToken();
  if (!clientId || !refreshToken) return false;

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) return false;
    const data = await res.json();
    // Spotify may omit refresh_token on refresh responses; keep existing one.
    setTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in,
    });
    return true;
  } catch {
    return false;
  }
}

async function spotifyFetchJson(url) {
  const ok = await refreshAccessTokenIfNeeded();
  if (!ok) throw new Error("Not authenticated");

  const token = getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204) return null; // no content
  if (res.status === 401) {
    // token invalid; clear and force relogin
    clearTokens();
    throw new Error("Unauthorized");
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || "1");
    throw Object.assign(new Error("Rate limited"), { retryAfter });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spotify API error ${res.status}: ${text}`);
  }
  return res.json();
}

function updateTrackUI(data) {
  if (!data || !data.item) {
    els.title.textContent = "—";
    els.artist.textContent = "—";
    els.cover.removeAttribute("src");
    els.chordsGoogle.href = "#";
    els.chordsGoogle.dataset.query = "";
    els.spotifyOpen.href = "#";
    setStatus("אין שיר כרגע");
    closeChordsViewer();
    return;
  }

  const track = data.item;
  const title = track.name || "Unknown";
  const artists = (track.artists || []).map(a => a.name).filter(Boolean).join(", ");
  const cover = track.album?.images?.[0]?.url || "";
  const spotifyUrl = track.external_urls?.spotify || "";

  els.title.textContent = title;
  els.artist.textContent = artists || "—";
  if (cover) els.cover.src = cover;

  const playing = !!data.is_playing;
  setStatus(playing ? "מתנגן עכשיו ✅" : "מושהה ⏸");

  const query = `${artists} ${title}`;
  els.chordsGoogle.href = "#";
  els.chordsGoogle.dataset.query = query;
  els.spotifyOpen.href = spotifyUrl || "#";
}

let pollTimer = null;
let backoffMs = 5000;

async function pollOnce() {
  try {
    setDebug("");
    const data = await spotifyFetchJson("https://api.spotify.com/v1/me/player/currently-playing");
    updateTrackUI(data);
    backoffMs = 5000; // reset
  } catch (e) {
    if (e && typeof e.retryAfter === "number") {
      backoffMs = Math.min(60000, Math.max(5000, e.retryAfter * 1000));
      setStatus("רגע… Spotify מגביל בקשות (429)");
      setDebug(`Retry-After: ${Math.round(backoffMs/1000)}s`);
    } else if (String(e.message || "").includes("Not authenticated")) {
      setPill("bad", "לא מחובר");
      setStatus("לא מחובר — לחץ התחבר");
    } else if (String(e.message || "").includes("Unauthorized")) {
      setPill("bad", "החיבור פג");
      setStatus("החיבור פג — התחבר מחדש");
    } else {
      setStatus("שגיאה מול Spotify");
      setDebug(e?.message || String(e));
    }
  } finally {
    // schedule next poll
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollOnce, backoffMs);
  }
}

function syncSetupUI() {
  els.redirectUri.textContent = redirectUri();
  const cid = getClientId();
  els.clientIdInput.value = cid;
  if (els.apiBaseInput) {
    els.apiBaseInput.value = getApiBase();
  }

  if (getAccessToken() && !tokenExpired()) {
    setPill("ok", "מחובר");
    setStatus("טוען…");
  } else if (getRefreshToken()) {
    setPill("ok", "מחובר (מרענן…)"); // will refresh on first call
    setStatus("טוען…");
  } else {
    setPill("bad", "לא מחובר");
    setStatus("—");
  }
}

els.copyRedirectBtn?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(redirectUri());
    els.copyRedirectBtn.textContent = "הועתק!";
    setTimeout(() => (els.copyRedirectBtn.textContent = "העתק"), 1200);
  } catch {
    alert("לא הצלחתי להעתיק. תעתיק ידנית מהתיבה.");
  }
});

els.saveClientIdBtn?.addEventListener("click", () => {
  const v = (els.clientIdInput.value || "").trim();
  if (!v) return alert("Client ID ריק");
  setClientId(v);
  setPill("ok", "Client ID נשמר");
  setTimeout(() => syncSetupUI(), 300);
});

els.saveApiBaseBtn?.addEventListener("click", () => {
  const v = (els.apiBaseInput?.value || "").trim();
  if (v) {
    if (!/^https?:\/\//i.test(v)) {
      alert("כתובת Backend חייבת להתחיל ב-http:// או https://");
      return;
    }
    setApiBase(v);
  } else {
    setApiBase("");
  }

  backendHealthCache = { ok: null, checkedAt: 0 };
  setPill("ok", "Backend נשמר");
  setTimeout(() => syncSetupUI(), 300);
});

els.loginBtn?.addEventListener("click", startLogin);

els.logoutBtn?.addEventListener("click", () => {
  clearTokens();
  setPill("bad", "התנתקת");
  updateTrackUI(null);
  setStatus("—");
});

els.chordsGoogle?.addEventListener("click", (event) => {
  event.preventDefault();

  const query = els.chordsGoogle.dataset.query || "";
  if (!query) return;

  void openChordsViewer(query);
});

els.chordsFrame?.addEventListener("load", () => {
  const host = safeHost(els.chordsFrame?.src || "");
  if (els.chordsHint) {
    if (host.includes("bing.com")) {
      els.chordsHint.textContent = "נטענו תוצאות החיפוש בתוך האפליקציה.";
    } else {
      els.chordsHint.textContent = "האתר נטען בתוך האפליקציה.";
    }
  }
});

els.closeChordsBtn?.addEventListener("click", () => {
  closeChordsViewer();
});

(function init() {
  syncSetupUI();
  pollOnce();
})();
