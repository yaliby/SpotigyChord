// Spotify → Chords (static site)
// No code edits needed: user enters Client ID in the UI once.
// Redirect URI is displayed on screen for copy/paste into Spotify app settings.

const LS = {
  clientId: "spch_client_id",
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
  openChordsNewTab: document.getElementById("openChordsNewTab"),
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

function googleSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function googleFirstResultUrl(query) {
  // btnI = "I'm Feeling Lucky" (redirect to first result)
  return `https://www.google.com/search?btnI=1&q=${encodeURIComponent(query)}`;
}

let frameFallbackTimer = null;

function closeChordsViewer() {
  if (!els.chordsCard || !els.chordsFrame) return;
  els.chordsCard.classList.remove("open");
  els.chordsFrame.removeAttribute("src");
  if (els.chordsHint) {
    els.chordsHint.textContent = 'לחץ על "פתח אקורדים כאן" כדי לטעון את האתר הראשון של Google ישירות בתוך הדף.';
  }
  clearTimeout(frameFallbackTimer);
}

function openChordsViewer(url) {
  if (!url || url === "#") return;

  if (!els.chordsCard || !els.chordsFrame) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  els.chordsCard.classList.add("open");
  els.chordsFrame.src = url;

  if (els.openChordsNewTab) els.openChordsNewTab.href = url;
  if (els.chordsHint) els.chordsHint.textContent = "טוען את האתר הראשון…";

  clearTimeout(frameFallbackTimer);
  frameFallbackTimer = setTimeout(() => {
    if (els.chordsHint) {
      els.chordsHint.textContent = "אם האתר לא נטען כאן, לחץ על \"פתח בלשונית\". חלק מהאתרים חוסמים הצגה בתוך iframe.";
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
    if (els.openChordsNewTab) els.openChordsNewTab.href = "#";
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

  const query = `${artists} ${title} chords`;
  els.chordsGoogle.href = googleFirstResultUrl(query);
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

els.loginBtn?.addEventListener("click", startLogin);

els.logoutBtn?.addEventListener("click", () => {
  clearTokens();
  setPill("bad", "התנתקת");
  updateTrackUI(null);
  setStatus("—");
});

els.chordsGoogle?.addEventListener("click", (event) => {
  event.preventDefault();

  const href = els.chordsGoogle.href || "#";
  if (!href || href === "#") return;

  openChordsViewer(href);
});

els.chordsFrame?.addEventListener("load", () => {
  if (els.chordsHint) {
    const query = els.chordsGoogle?.dataset?.query || "";
    const fallback = query ? googleSearchUrl(query) : "#";
    els.chordsHint.textContent = "הטעינה הושלמה. אם זו לא התוצאה שרצית, השתמש ב\"פתח בלשונית\" או חזור לחיפוש Google.";
    if (els.openChordsNewTab && els.openChordsNewTab.href === "#") {
      els.openChordsNewTab.href = fallback;
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
