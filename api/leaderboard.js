/*
 * Leaderboard proxy.
 *
 * The browser calls /api/leaderboard?board=razed. This function calls the
 * casino's affiliate API with the referral key and returns only what the page
 * needs: a name, an avatar and an amount wagered per place.
 *
 * The key is read from the environment and is never sent to the browser, never
 * logged, and never committed. Set it in Vercel under Project → Settings →
 * Environment Variables (see README).
 *
 *   RAZED_REFERRAL_KEY     required, the X-Referral-Key for razed.com
 *   RAZED_API_URL          optional, overrides the endpoint
 *   RAZED_REFERRAL_CODE    optional, overrides the code from data.js
 *   RAZEDIO_REFERRAL_KEY   same three for Razed.IO, once that API exists
 *   RAZEDIO_API_URL
 *   RAZEDIO_REFERRAL_CODE
 */

const CONFIG = require("../data.js").REKOJ_CONFIG;

const DEFAULT_API_URL = "https://api.razed.com/player/api/v1/referrals/leaderboard";
const REQUEST_TIMEOUT_MS = 8000;

/** Envvar prefix per board: razed -> RAZED_, razedio -> RAZEDIO_ */
function envPrefix(board) {
  return board.toUpperCase().replace(/[^A-Z0-9]/g, "") + "_";
}

/** Today, or the last day of the period if that has passed. YYYY-MM-DD, UTC. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

function windowFor(board) {
  const period = board.period || {};
  const to = period.to && period.to < today() ? period.to : today();
  return { from: period.from, to };
}

/**
 * Pull the rows out of whatever shape the API returns, and read each row's
 * fields under any of the names these APIs commonly use. Tolerant on purpose:
 * the exact shape is unconfirmed, so this accepts the likely ones rather than
 * breaking the page on a rename.
 */
function rowsFrom(json) {
  if (Array.isArray(json)) return json;
  for (const key of ["data", "leaderboard", "entries", "results", "players", "items"]) {
    const value = json && json[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.data)) return value.data;
  }
  return [];
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

function mapRow(row) {
  const name = pick(row, [
    "masked_username", "maskedUsername", "username", "name", "player", "player_name", "nickname",
  ]);
  const wagered = pick(row, [
    "wagered", "wager", "wagered_amount", "wageredAmount", "total_wagered", "totalWagered",
    "amount", "turnover", "volume",
  ]);
  return {
    name: name == null ? null : String(name),
    avatar: pick(row, ["avatar", "avatar_url", "avatarUrl", "image", "picture"]) || null,
    wagered: Number(wagered) || 0,
  };
}

module.exports = async function handler(req, res) {
  const key = String((req.query && req.query.board) || "razed");
  const board = CONFIG.boards[key];

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!board) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Unknown board" }));
  }

  const prefix = envPrefix(key);
  const referralKey = process.env[prefix + "REFERRAL_KEY"];
  if (!referralKey) {
    // No key configured: let the page fall back to the entries in data.js.
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: "Leaderboard key not configured for " + key }));
  }

  const endpoint = process.env[prefix + "API_URL"] || DEFAULT_API_URL;
  const code = process.env[prefix + "REFERRAL_CODE"] || board.referralCode || CONFIG.code.toLowerCase();
  const range = windowFor(board);

  const url = new URL(endpoint);
  url.searchParams.set("referral_codes", code);
  if (range.from) url.searchParams.set("from", range.from);
  if (range.to) url.searchParams.set("to", range.to);
  url.searchParams.set("top", String(board.places || 10));

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      headers: { "X-Referral-Key": referralKey, Accept: "application/json" },
      signal: abort.signal,
    });

    const body = await upstream.text();

    if (!upstream.ok) {
      // Report the status, never the key or the full request URL.
      console.error("[leaderboard] %s upstream %s: %s", key, upstream.status, body.slice(0, 300));
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: "Upstream error", status: upstream.status }));
    }

    let json;
    try {
      json = JSON.parse(body);
    } catch (err) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: "Upstream did not return JSON" }));
    }

    const entries = rowsFrom(json)
      .map(mapRow)
      .filter((entry) => entry.name)
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, board.places || 10);

    // Cached at the edge for a minute; stale copies served while revalidating.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.statusCode = 200;
    return res.end(JSON.stringify({ board: key, from: range.from, to: range.to, entries }));
  } catch (err) {
    const reason = err && err.name === "AbortError" ? "Upstream timed out" : "Upstream unreachable";
    console.error("[leaderboard] %s %s", key, reason);
    res.statusCode = 504;
    return res.end(JSON.stringify({ error: reason }));
  } finally {
    clearTimeout(timer);
  }
};
