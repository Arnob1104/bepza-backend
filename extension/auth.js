/* auth.js — login/refresh go directly to Supabase Auth (using the
 * public "publishable" key — safe to ship in a client, same role as the
 * old "anon" key). Only AI extraction goes through OUR backend, which is
 * the one place that holds the real AI provider key.
 *
 * Change BACKEND_URL to your deployed backend's URL before distributing
 * this extension. SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY come from your
 * Supabase project (Settings → API) — these are meant to be public and
 * are safe to keep in the extension. NEVER put the Supabase *secret* key
 * here — that one lives only in backend/.env.
 */
const BACKEND_URL = "http://localhost:8000"; // TODO: change to e.g. "https://api.yourdomain.com" in production
const SUPABASE_URL = "https://dehxcpnbxyvpavpiuyju.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZdaZFSOrb-KjQyrL6zcw6g_OFVNT2uP";

const TOKEN_KEYS = ["accessToken", "refreshToken", "userEmail"];

async function getStoredTokens() {
  const res = await chrome.storage.local.get(TOKEN_KEYS);
  return {
    accessToken: res.accessToken || "",
    refreshToken: res.refreshToken || "",
    userEmail: res.userEmail || "",
  };
}

async function setStoredTokens({ accessToken, refreshToken, userEmail }) {
  const toSet = {};
  if (accessToken !== undefined) toSet.accessToken = accessToken;
  if (refreshToken !== undefined) toSet.refreshToken = refreshToken;
  if (userEmail !== undefined) toSet.userEmail = userEmail;
  await chrome.storage.local.set(toSet);
}

async function clearStoredTokens() {
  await chrome.storage.local.remove(TOKEN_KEYS);
}

async function isLoggedIn() {
  const { accessToken } = await getStoredTokens();
  return !!accessToken;
}

/* ── Login / logout (direct to Supabase Auth) ── */
async function login(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Supabase error messages are already safe to show as-is (e.g.
    // "Invalid login credentials") — no AI provider details ever pass
    // through this call.
    throw new Error(body.error_description || body.msg || "Login failed. Check your email and password.");
  }
  const data = await res.json();
  await setStoredTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    userEmail: email,
  });
  return true;
}

async function logout() {
  await clearStoredTokens();
}

/* ── Silent access-token refresh (direct to Supabase Auth) ── */
async function refreshAccessToken() {
  const { refreshToken } = await getStoredTokens();
  if (!refreshToken) return false;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    // Refresh token itself is invalid/expired/revoked.
    await clearStoredTokens();
    return false;
  }
  const data = await res.json();
  // Supabase rotates refresh tokens on use — must store the new one too,
  // or the NEXT refresh will fail with an already-used-token error.
  await setStoredTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  });
  return true;
}

/* ── Authenticated fetch to OUR backend only ─────────────────────────
 * (Supabase calls above use the publishable key directly; this is only
 * for /api/extract and friends, which need the Supabase-issued access
 * token verified server-side against our own is_active flag.)
 * Retries once after a silent refresh on 401, and throws a distinguishable
 * error if the session truly can't be recovered (expired refresh token,
 * or the account was disabled) so the UI can drop back to the login screen.
 */
class AuthRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

async function authFetch(path, options = {}, _retried = false) {
  const { accessToken } = await getStoredTokens();
  if (!accessToken) throw new AuthRequiredError("Not logged in.");

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 && !_retried) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return authFetch(path, options, true);
    await clearStoredTokens();
    throw new AuthRequiredError("Your session expired. Please log in again.");
  }

  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    await clearStoredTokens();
    throw new AuthRequiredError(body.detail || "This account has been disabled.");
  }

  return res;
}
