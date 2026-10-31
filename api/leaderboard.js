/*
 * Leaderboard proxy.
 *
 * The browser calls /api/leaderboard?board=razed. This function calls the
 * casino's affiliate API with the secret key and returns only what the page
 * needs: a name, an avatar and an amount wagered per place.
 *
 * The keys are read from the environment and are never sent to the browser,
 * never logged, and never committed. Set them in Vercel under
 * Project → Settings → Environment Variables (see README).
 *
 *   RAZED_REFERRAL_KEY     required for Razed, sent as X-Referral-Key
 *   RAZEDIO_API_KEY        required for Razed.IO, sent as x-api-key
 *   <BOARD>_API_URL        optional, overrides the endpoint
 *   <BOARD>_REFERRAL_CODE  optional, overrides the code from data.js
 *
 * The two casinos run different APIs, so each board names a flavour in
 * data.js (`apiFlavor`), and server/leaderboards.js holds everything specific
 * to it: the endpoint, the auth header, how the window is expressed, and how
 * a row is read. That's also where each finished month's winners are kept.
 */

const CONFIG = require("../data.js").REKOJ_CONFIG;
const boards = require("../server/leaderboards");

const FRESH_MS = 60 * 1000; // both APIs cache for a minute anyway
const CLOSING_FRESH_MS = 15 * 1000;

// Last good answer per board, kept for as long as this instance is warm.
// Razed.IO allows one request per second, so a burst of visitors would
// otherwise get 429s; this also lets a brief outage serve the last standings
// instead of the page's sample rows.
const lastGood = new Map();
// One upstream request per board at a time; concurrent visitors share it.
const inflight = new Map();

function send(res, status, payload, cacheControl) {
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);
  res.statusCode = status;
  return res.end(JSON.stringify(payload));
}

function sendStale(res, key, reason, month) {
  const hit = lastGood.get(key);
  if (!hit || hit.payload.month !== month) return false;
  console.warn("[leaderboard] %s %s; serving standings from %ss ago", key, reason, Math.round((Date.now() - hit.at) / 1000));
  res.setHeader("X-Leaderboard-Stale", "1");
  send(res, 200, hit.payload, "public, s-maxage=15, stale-while-revalidate=300");
  return true;
}

module.exports = async function handler(req, res) {
  const key = String((req.query && req.query.board) || "razed");
  const board = CONFIG.boards[key];

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!board) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Unknown board" }));
  }
  if (!boards.flavourOf(key)) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "No API flavour for " + key }));
  }
  if (!boards.secretOf(key)) {
    // No key configured: let the page fall back to the entries in data.js.
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: "Leaderboard key not configured for " + key }));
  }

  const now = Date.now();
  const season = CONFIG.season(key, now);
  // Last month ended? Keep its winners (a no-op once they're kept).
  await boards.ensure(key, now).catch(() => {});

  // Close to the end, look again more often so the final standings are recent.
  const closing = season.end - now <= boards.SNAPSHOT_FROM;
  const fresh = closing ? CLOSING_FRESH_MS : FRESH_MS;
  const edge = closing ? "public, s-maxage=15" : "public, s-maxage=60, stale-while-revalidate=300";

  const cached = lastGood.get(key);
  if (cached && cached.payload.month === season.id && now - cached.at < fresh) {
    return send(res, 200, cached.payload, edge);
  }

  try {
    let shared = inflight.get(key);
    if (!shared || shared.month !== season.id) {
      shared = boards.fetchStandings(key, season).finally(() => { if (inflight.get(key) === shared) inflight.delete(key); });
      shared.month = season.id;
      inflight.set(key, shared);
    }
    const entries = await shared;
    const payload = { board: key, month: season.id, from: season.firstDay, ends: new Date(season.end).toISOString(), entries };
    lastGood.set(key, { at: Date.now(), payload });
    // The last 15 minutes: keep what the board shows, for the final result.
    await boards.noteLive(key, season, entries).catch((err) => console.error("[leaderboard] couldn't save the standings:", err.message));
    return send(res, 200, payload, edge);
  } catch (err) {
    if (sendStale(res, key, err.message, season.id)) return;
    return send(res, err.status || 502, { error: err.message });
  }
};
