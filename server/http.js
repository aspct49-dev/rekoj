/*
 * Small HTTP helpers shared by the API: JSON replies, redirects, cookies and
 * request bodies. Works the same under Vercel's Node runtime and the local
 * dev server.
 */

function json(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function redirect(res, location, cookies) {
  res.statusCode = 302;
  if (cookies && cookies.length) res.setHeader("Set-Cookie", cookies);
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Set-Cookie value. maxAge in seconds; 0 deletes. */
function cookie(name, value, maxAge, secure) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ].filter(Boolean).join("; ");
}

/** The site's own origin, for OAuth redirects. AUTH_URL wins if set. */
function origin(req) {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() ||
    (req.socket && req.socket.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function isSecure(req) {
  return origin(req).startsWith("https://");
}

/** Request body as an object. Vercel may have parsed it already. */
async function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
    }
    return req.body || {};
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text || "{}"); } catch (e) { return {}; }
}

/**
 * State-changing requests must come from this site. The session cookie is
 * SameSite=Lax, which already blocks cross-site POSTs; this is a second check.
 */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true; // same-origin fetches from older browsers omit it
  try {
    return new URL(o).host === String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  } catch (e) {
    return false;
  }
}

/** A path on this site to come back to after signing in. */
function safeReturn(value, fallback) {
  const v = String(value || "");
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
}

module.exports = { json, redirect, parseCookies, cookie, origin, isSecure, readJson, sameOrigin, safeReturn };
