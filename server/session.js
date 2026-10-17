/*
 * Signed cookies: the session (who is signed in) and the short-lived OAuth
 * state. Values are JSON, signed with HMAC-SHA256 using SESSION_SECRET, so
 * they can be read but not forged. Nothing secret goes in them.
 */
const crypto = require("crypto");
const { parseCookies, cookie, isSecure } = require("./http");

const SESSION_COOKIE = "rekoj_session";
const SESSION_DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw Object.assign(new Error("SESSION_SECRET is not set."), { status: 500 });
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + mac;
}

function unsign(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/** The signed-in user, or null: { id, username, avatar } */
function readSession(req) {
  const v = unsign(parseCookies(req)[SESSION_COOKIE]);
  return v && v.user ? v.user : null;
}

function sessionCookie(req, user) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return cookie(SESSION_COOKIE, sign({ user, exp }), SESSION_DAYS * 86400, isSecure(req));
}

function clearSessionCookie(req) {
  return cookie(SESSION_COOKIE, "", 0, isSecure(req));
}

/** Short-lived signed cookie (OAuth state + PKCE verifier). */
function tempCookie(req, name, value, minutes) {
  const exp = Math.floor(Date.now() / 1000) + minutes * 60;
  return cookie(name, sign({ value, exp }), minutes * 60, isSecure(req));
}

function readTemp(req, name) {
  const v = unsign(parseCookies(req)[name]);
  return v ? v.value : null;
}

function clearTemp(req, name) {
  return cookie(name, "", 0, isSecure(req));
}

/** Admins are Kick usernames listed in ADMIN_KICK_USERNAMES (comma separated). */
function isAdmin(user) {
  if (!user) return false;
  const list = String(process.env.ADMIN_KICK_USERNAMES || "rekoj,aspect900")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(user.username || "").toLowerCase());
}

module.exports = { readSession, sessionCookie, clearSessionCookie, tempCookie, readTemp, clearTemp, isAdmin };
