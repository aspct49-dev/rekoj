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
 * data.js (`apiFlavor`) and FLAVOURS below holds everything specific to it:
 * the endpoint, the auth header, how the window is expressed, and how a row
 * is read.
 */

const CONFIG = require("../data.js").REKOJ_CONFIG;

const REQUEST_TIMEOUT_MS = 8000;

/** First value present under any of `keys`. */
function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

/**
 * Field names are read loosely on purpose: a rename upstream should cost a
 * field, not the whole board.
 */
function commonRow(row) {
  return {
    name: pick(row, ["masked_username", "maskedUsername", "username", "name", "player", "nickname"]),
    avatar: pick(row, ["avatar", "avatar_url", "avatarUrl", "image", "picture"]) || null,
    wagered: Number(
      pick(row, ["wagered", "wager", "wagered_amount", "total_wagered", "totalWagered", "amount", "turnover"])
    ) || 0,
  };
}

const FLAVOURS = {
  /*
   * razed.com — GET /player/api/v1/referrals/leaderboard
   *   ?referral_code=rekoj&from=2026-09-20&to=2026-10-31&top=10
   * Note the singular `referral_code`; the plural form 404s. Answers with
   *   { total, from, to, data: [ { username, referred_by_code, wagered } ] }
   */
  razed: {
    url: "https://api.razed.com/player/api/v1/referrals/leaderboard",
    keyEnv: ["REFERRAL_KEY", "API_KEY"],
    header: "X-Referral-Key",
    params(url, { code, period, places }) {
      url.searchParams.set("referral_code", code);
      if (period.from) url.searchParams.set("from", period.from);
      if (period.to) url.searchParams.set("to", period.to);
      url.searchParams.set("top", String(places));
    },
    rows: (json) => (Array.isArray(json) ? json : (json && json.data) || []),
    row: commonRow,
  },

  /*
   * razed.io — GET /externals/affiliates
   *   ?codes=rekoj&startDate=2026-09-20T00:00:00Z&endDate=2026-10-31T23:59:59Z
   * Answers with a bare array of
   *   { id, username, avatar, wagered, deposited, stillUnderCode }
   * Dates need an explicit offset, amounts are decimal strings, and players
   * who have since moved to another code come back with stillUnderCode:false
   * (their wagering under this code still counts, so they are kept).
   */
  razedio: {
    url: "https://api.razed.io/externals/affiliates",
    keyEnv: ["API_KEY", "REFERRAL_KEY"],
    header: "x-api-key",
    params(url, { code, period }) {
      url.searchParams.set("codes", code);
      if (period.from) url.searchParams.set("startDate", period.from + "T00:00:00Z");
      if (period.to) url.searchParams.set("endDate", period.to + "T23:59:59Z");
    },
    rows: (json) => (Array.isArray(json) ? json : (json && json.data) || []),
    row: commonRow,
  },
};

/** Envvar prefix per board: razed -> RAZED_, razedio -> RAZEDIO_ */
function envPrefix(board) {
  return board.toUpperCase().replace(/[^A-Z0-9]/g, "") + "_";
}

module.exports = async function handler(req, res) {
  const key = String((req.query && req.query.board) || "razed");
  const board = CONFIG.boards[key];

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!board) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Unknown board" }));
  }

  const flavour = FLAVOURS[board.apiFlavor || key];
  if (!flavour) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "No API flavour for " + key }));
  }

  const prefix = envPrefix(key);
  const secret = flavour.keyEnv.map((name) => process.env[prefix + name]).find(Boolean);
  if (!secret) {
    // No key configured: let the page fall back to the entries in data.js.
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: "Leaderboard key not configured for " + key }));
  }

  const places = board.places || 10;
  const period = board.period || {};
  const code = process.env[prefix + "REFERRAL_CODE"] || board.referralCode || CONFIG.code.toLowerCase();

  const url = new URL(process.env[prefix + "API_URL"] || flavour.url);
  flavour.params(url, { code, period, places });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      headers: { [flavour.header]: secret, Accept: "application/json" },
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

    // Razed.IO returns everyone who clicked the code, including players who
    // have wagered nothing; they would otherwise sit in a paying place ahead
    // of an empty slot, so only actual wagering makes the board.
    const entries = flavour
      .rows(json)
      .map(flavour.row)
      .filter((entry) => entry.name && entry.wagered > 0)
      .map((entry) => ({ ...entry, name: String(entry.name) }))
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, places);

    // Cached at the edge for a minute, which is also how long both APIs cache.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.statusCode = 200;
    return res.end(JSON.stringify({ board: key, from: period.from, to: period.to, entries }));
  } catch (err) {
    const reason = err && err.name === "AbortError" ? "Upstream timed out" : "Upstream unreachable";
    console.error("[leaderboard] %s %s", key, reason);
    res.statusCode = 504;
    return res.end(JSON.stringify({ error: reason }));
  } finally {
    clearTimeout(timer);
  }
};
