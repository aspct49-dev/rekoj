/*
 * BotRix loyalty points ("Rekoj points") for the Kick channel.
 *
 * Reading needs no credentials: the public leaderboard answers "how many
 * points does <viewer> have on this channel":
 *   GET https://botrix.live/api/public/leaderboard?platform=kick&user=<channel>&search=<viewer>
 *
 * Changing points uses the extension endpoint with the channel's bid token
 * (BOTRIX_BID, server-side only):
 *   GET https://botrix.live/api/extension/substractPoints?name=<viewer>&platform=kick&points=<n>&bid=<bid>
 *   → { success: true } | { success: false, reason: "user_not_found" | … }
 * BotRix's sign convention: a positive n TAKES points, a negative n ADDS them.
 * A wrong bid gets an empty 200 reply.
 *
 * BotRix allows about 100 requests a minute per server before refusing
 * everything for ~40s, so calls share a budget below that and back off on 429.
 */
const BASE = (process.env.BOTRIX_API_BASE || "https://botrix.live").replace(/\/+$/, "");
const CHANNEL = () => process.env.BOTRIX_CHANNEL || "rekoj";
const UA = "Mozilla/5.0";
const PER_MIN = 80;
const CACHE_MS = 30 * 1000;

class BotrixError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

const sent = [];
let blockedUntil = 0;
async function botrixFetch(url) {
  const now = Date.now();
  while (sent.length && now - sent[0] > 60000) sent.shift();
  if (now < blockedUntil) throw new BotrixError("BotRix is busy. Please try again in a moment.", "busy", 503);
  if (sent.length >= PER_MIN) throw new BotrixError("BotRix is busy. Please try again in a moment.", "busy", 503);
  sent.push(now);
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after")) || 40;
    blockedUntil = Date.now() + wait * 1000;
    throw new BotrixError("BotRix is busy. Please try again in a moment.", "busy", 503);
  }
  return res;
}

const cache = new Map();

/** { name, points, watchtime (minutes), level } or null if BotRix doesn't know them yet */
async function getViewer(name) {
  const key = String(name || "").toLowerCase();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.viewer;
  const url = new URL(BASE + "/api/public/leaderboard");
  url.searchParams.set("platform", "kick");
  url.searchParams.set("user", CHANNEL());
  url.searchParams.set("search", name);
  let rows;
  try {
    const res = await botrixFetch(url);
    if (!res.ok) throw new BotrixError("Could not reach BotRix.", "unreachable", 502);
    rows = await res.json();
  } catch (err) {
    if (err instanceof BotrixError) throw err;
    throw new BotrixError("Could not reach BotRix.", "unreachable", 502);
  }
  const row = (Array.isArray(rows) ? rows : []).find((r) => String(r.name || "").toLowerCase() === key) || null;
  const viewer = row ? { name: row.name, points: Number(row.points) || 0, watchtime: Number(row.watchtime) || 0, level: Number(row.level) || 0 } : null;
  cache.set(key, { at: Date.now(), viewer });
  return viewer;
}

/** Add (delta > 0) or take (delta < 0) points. Throws BotrixError with a message fit to show. */
async function adjustPoints(name, delta) {
  const bid = process.env.BOTRIX_BID;
  if (!bid) throw new BotrixError("Points aren't set up yet (BOTRIX_BID).", "bid", 500);
  if (!Number.isInteger(delta) || delta === 0) throw new BotrixError("Change points by a whole number.", "input");
  const url = new URL(BASE + "/api/extension/substractPoints");
  url.searchParams.set("name", name);
  url.searchParams.set("platform", "kick");
  url.searchParams.set("points", String(-delta)); // BotRix: positive takes, negative adds
  url.searchParams.set("bid", bid);

  let text;
  try {
    const res = await botrixFetch(url);
    text = await res.text();
    if (!res.ok) throw new BotrixError("BotRix answered " + res.status + ".", "unreachable", 502);
  } catch (err) {
    if (err instanceof BotrixError) throw err;
    throw new BotrixError("Could not reach BotRix. Please try again.", "unreachable", 502);
  } finally {
    cache.delete(String(name).toLowerCase());
  }

  let body = null;
  try { body = text.trim() ? JSON.parse(text) : null; } catch (e) { body = null; }
  if (!body) throw new BotrixError("BotRix refused the bid token (BOTRIX_BID).", "bid", 500);
  if (body.success) return;
  const reason = String(body.reason || "");
  if (reason === "user_not_found") {
    throw new BotrixError(`BotRix doesn't know ${name} on this channel yet. Watch a stream with chat open to start earning points.`, "user_not_found");
  }
  if (delta < 0) throw new BotrixError("Not enough points.", "insufficient");
  throw new BotrixError("BotRix didn't make the change" + (reason ? " (" + reason + ")" : "") + ".", reason || "failed");
}

module.exports = { getViewer, adjustPoints, BotrixError, CHANNEL };
