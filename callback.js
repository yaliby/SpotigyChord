// Spotify PKCE callback handler
const LS = {
  clientId: "spch_client_id",
  accessToken: "spch_access_token",
  refreshToken: "spch_refresh_token",
  expiresAt: "spch_expires_at",
  pkceVerifier: "spch_pkce_verifier",
  oauthState: "spch_oauth_state",
};

const msg = document.getElementById("msg");

function baseDirUrl() {
  const url = new URL(location.href);
  url.pathname = url.pathname.replace(/callback\.html$/i, "");
  if (!url.pathname.endsWith("/")) {
    url.pathname = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function redirectUri() {
  return `${baseDirUrl()}callback.html`;
}

function setMsg(t) {
  if (msg) msg.textContent = t;
}

function getClientId() {
  return localStorage.getItem(LS.clientId) || "";
}

function getVerifier() {
  return localStorage.getItem(LS.pkceVerifier) || "";
}

function getExpectedState() {
  return localStorage.getItem(LS.oauthState) || "";
}

function setTokens({ access_token, refresh_token, expires_in }) {
  if (access_token) localStorage.setItem(LS.accessToken, access_token);
  if (refresh_token) localStorage.setItem(LS.refreshToken, refresh_token);
  const expiresAt = Date.now() + (Number(expires_in || 3600) * 1000) - 5000;
  localStorage.setItem(LS.expiresAt, String(expiresAt));
}

async function exchangeCode(code) {
  const clientId = getClientId();
  const verifier = getVerifier();
  if (!clientId) throw new Error("Missing Client ID (go back and paste it).");
  if (!verifier) throw new Error("Missing PKCE verifier (try login again).");

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${t}`);
  }
  return res.json();
}

(async function run() {
  try {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const error = params.get("error");
    const state = params.get("state");

    if (error) throw new Error(`Spotify error: ${error}`);
    if (!code) throw new Error("No code in callback.");
    if (state !== getExpectedState()) throw new Error("State mismatch. Try again.");

    setMsg("מחליף קוד לטוקן…");
    const token = await exchangeCode(code);

    setTokens({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
    });

    // cleanup one-time values
    localStorage.removeItem(LS.pkceVerifier);
    localStorage.removeItem(LS.oauthState);

    setMsg("הצלחה! חוזר לדף הראשי…");
    location.replace(`${baseDirUrl()}index.html`);
  } catch (e) {
    console.error(e);
    setMsg(e?.message || String(e));
  }
})();
