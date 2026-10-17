/*
 * Sign in with Kick (OAuth 2.1 with PKCE).
 *
 *   GET /api/auth/kick/login?return=/path   → redirect to Kick
 *   GET /api/auth/kick/callback             → back from Kick: sign in, return to the page
 *   POST /api/auth/logout                   → sign out
 *
 * The state and PKCE verifier ride in a signed, 10-minute cookie. Only the
 * user:read scope is asked for. Register these redirect URLs on the Kick app:
 *   https://<domain>/api/auth/kick/callback (and http://localhost:5173/… for local)
 */
const crypto = require("crypto");
const { json, redirect, origin, safeReturn } = require("./http");
const { sessionCookie, clearSessionCookie, tempCookie, readTemp, clearTemp } = require("./session");
const store = require("./store");

const AUTHORIZE = "https://id.kick.com/oauth/authorize";
const TOKEN = "https://id.kick.com/oauth/token";
const USERS = "https://api.kick.com/public/v1/users";
const UA = "Mozilla/5.0"; // Kick sits behind Cloudflare, which turns away requests without one
const STATE_COOKIE = "rekoj_oauth";
const STATE_MINUTES = 10;

function backWithError(req, res, returnTo, message) {
  const url = new URL(returnTo, origin(req));
  url.searchParams.set("auth_error", message);
  return redirect(res, url.pathname + url.search, [clearTemp(req, STATE_COOKIE)]);
}

async function login(req, res, url) {
  if (!process.env.KICK_CLIENT_ID || !process.env.KICK_CLIENT_SECRET) {
    return json(res, 500, { error: "Kick sign-in isn't set up (KICK_CLIENT_ID / KICK_CLIENT_SECRET)." });
  }
  const verifier = crypto.randomBytes(48).toString("base64url");
  const state = crypto.randomBytes(16).toString("base64url");
  const returnTo = safeReturn(url.searchParams.get("return"), "/profile");

  const authorize = new URL(AUTHORIZE);
  authorize.searchParams.set("client_id", process.env.KICK_CLIENT_ID);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", origin(req) + "/api/auth/kick/callback");
  authorize.searchParams.set("scope", "user:read");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
  authorize.searchParams.set("code_challenge_method", "S256");

  return redirect(res, authorize.toString(), [tempCookie(req, STATE_COOKIE, { state, verifier, returnTo }, STATE_MINUTES)]);
}

async function callback(req, res, url) {
  const saved = readTemp(req, STATE_COOKIE);
  const returnTo = safeReturn(saved && saved.returnTo, "/profile");
  if (url.searchParams.get("error")) return backWithError(req, res, returnTo, "Kick sign-in was cancelled.");
  if (!saved || saved.state !== url.searchParams.get("state")) {
    return backWithError(req, res, returnTo, "That sign-in link expired. Please try again.");
  }
  const code = url.searchParams.get("code");
  if (!code) return backWithError(req, res, returnTo, "Kick sign-in failed.");

  try {
    const tokenRes = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": UA },
      body: new URLSearchParams({
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: origin(req) + "/api/auth/kick/callback",
        code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const token = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !token || !token.access_token) {
      console.error("[auth] Kick token exchange failed:", tokenRes.status);
      return backWithError(req, res, returnTo, "Kick wouldn't sign you in. Please try again.");
    }

    const meRes = await fetch(USERS, {
      headers: { Authorization: "Bearer " + token.access_token, Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    const body = await meRes.json().catch(() => null);
    const me = body && (Array.isArray(body.data) ? body.data[0] : body.data);
    if (!meRes.ok || !me || !me.user_id) return backWithError(req, res, returnTo, "Kick wouldn't say who you are.");

    const picture = typeof me.profile_picture === "string" && me.profile_picture.startsWith("https://") ? me.profile_picture : null;
    const user = { id: String(me.user_id), username: me.name || "kick-" + me.user_id, avatar: picture };

    // Remember the account (best effort: signing in still works without storage)
    try {
      await store.update("users", (users) => {
        const prev = users[user.id] || { createdAt: Date.now() };
        users[user.id] = Object.assign({}, prev, user, { lastSeen: Date.now() });
      });
    } catch (err) {
      console.warn("[auth] couldn't save the account:", err.message);
    }

    return redirect(res, returnTo, [clearTemp(req, STATE_COOKIE), sessionCookie(req, user)]);
  } catch (err) {
    console.error("[auth] Kick sign-in error:", err.message);
    return backWithError(req, res, returnTo, "Couldn't reach Kick. Please try again.");
  }
}

function logout(req, res) {
  return json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(req) });
}

module.exports = { login, callback, logout };
