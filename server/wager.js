/*
 * How much each player wagered under the RekoJ code over a time window: what
 * wager raffles turn into tickets, and what an admin checks before approving
 * a linked username.
 *
 * razed.com   GET /player/api/v1/referrals/leaderboard?referral_code=&from=&to=&top=100&page=
 *             Whole UTC days, and `to` is EXCLUSIVE (from=to answers nothing).
 *             At most 45 days per request, at most 100 rows per page.
 * razed.io    GET /externals/affiliates?codes=&startDate=&endDate=
 *             Exact timestamps, everyone on the code in one answer, about one
 *             request a second.
 *
 * Answers are cached for a minute per window (both APIs cache that long
 * anyway), requests to one casino go one at a time, and if a casino is down
 * the last answer for that window is reused.
 */
const CONFIG = require("../data.js").REKOJ_CONFIG;

const DAY = 86400000;
const FRESH_MS = 60 * 1000;
const TIMEOUT_MS = 10000;
const RAZED_MAX_DAYS = 45;

const CASINOS = {
  razed: {
    name: "Razed",
    url: "https://api.razed.com/player/api/v1/referrals/leaderboard",
    keyEnv: ["RAZED_REFERRAL_KEY", "RAZED_API_KEY"],
    header: "X-Referral-Key",
    gap: 300,
  },
  razedio: {
    name: "Razed.IO",
    url: "https://api.razed.io/externals/affiliates",
    keyEnv: ["RAZEDIO_API_KEY", "RAZEDIO_REFERRAL_KEY"],
    header: "x-api-key",
    gap: 1100,
  },
};

class WagerError extends Error {
  constructor(message, status) { super(message); this.status = status || 502; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function secret(casino) {
  return CASINOS[casino].keyEnv.map((k) => process.env[k]).find(Boolean) || null;
}
function code(casino) {
  const board = CONFIG.boards[casino] || {};
  return process.env[casino.toUpperCase() + "_REFERRAL_CODE"] || board.referralCode || CONFIG.code.toLowerCase();
}
function configured(casino) { return !!(CASINOS[casino] && secret(casino)); }

/**
 * Razed counts whole UTC days: the window runs from the start of the day
 * `from` falls on to the end of the day `to` falls on (a `to` at exactly
 * midnight ends the day before).
 */
function razedDays(fromMs, toMs) {
  const start = Math.floor(fromMs / DAY) * DAY;
  const endExcl = Math.ceil(toMs / DAY) * DAY || start + DAY;
  const days = Math.max(1, Math.round((endExcl - start) / DAY));
  return { from: isoDay(start), to: isoDay(start + days * DAY), days };
}

/** Throws a WagerError a person can act on if the window can't be asked for. */
function checkWindow(casino, fromMs, toMs) {
  if (!CASINOS[casino]) throw new WagerError("Unknown casino.", 400);
  if (!(toMs > fromMs)) throw new WagerError("The wager window has to end after it starts.", 400);
  if (casino === "razed" && razedDays(fromMs, toMs).days > RAZED_MAX_DAYS) {
    throw new WagerError("Razed reports at most " + RAZED_MAX_DAYS + " days of wagering at a time; shorten the window.", 400);
  }
}

// One request at a time per casino, spaced out
const lanes = {};
function inLane(casino, task) {
  const run = (lanes[casino] || Promise.resolve()).then(task);
  lanes[casino] = run.catch(() => {}).then(() => sleep(CASINOS[casino].gap));
  return run;
}

async function call(casino, url) {
  const c = CASINOS[casino];
  const key = secret(casino);
  if (!key) throw new WagerError(c.name + " isn't connected (no API key set).", 503);
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { [c.header]: key, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new WagerError("Couldn't reach " + c.name + ". Please try again.");
    }
    if (res.status === 429 && attempt === 0) { await sleep(1500); continue; }
    const text = await res.text();
    if (!res.ok) {
      console.error("[wager] %s answered %s: %s", casino, res.status, text.slice(0, 200));
      throw new WagerError(c.name + " answered " + res.status + ".");
    }
    try { return JSON.parse(text); } catch (e) { throw new WagerError(c.name + " sent something unreadable."); }
  }
  throw new WagerError(c.name + " is busy. Please try again in a moment.", 503);
}

function readRows(json) { return Array.isArray(json) ? json : (json && json.data) || []; }
function addRow(map, row) {
  const name = String(row.username || row.name || "").trim();
  const wagered = Number(row.wagered) || 0;
  if (!name) return;
  const key = name.toLowerCase();
  const prev = map.get(key);
  const entry = { name, wagered: (prev ? prev.wagered : 0) + wagered };
  // Razed.IO only: false once the player has moved to another affiliate code
  if (row.stillUnderCode !== undefined) entry.stillUnderCode = row.stillUnderCode !== false;
  map.set(key, entry);
}

async function fetchRazed(fromMs, toMs) {
  const w = razedDays(fromMs, toMs);
  const base = process.env.RAZED_API_URL || CASINOS.razed.url;
  const map = new Map();
  for (let page = 1, last = 1; page <= last && page <= 50; page++) {
    const url = new URL(base);
    url.searchParams.set("referral_code", code("razed"));
    url.searchParams.set("from", w.from);
    url.searchParams.set("to", w.to);
    url.searchParams.set("top", "100");
    url.searchParams.set("page", String(page));
    const json = await inLane("razed", () => call("razed", url));
    readRows(json).forEach((r) => addRow(map, r));
    last = Number(json && json.last_page) || 1;
  }
  return map;
}

async function fetchRazedio(fromMs, toMs) {
  const url = new URL(process.env.RAZEDIO_API_URL || CASINOS.razedio.url);
  url.searchParams.set("codes", code("razedio"));
  url.searchParams.set("startDate", new Date(fromMs).toISOString().replace(/\.\d{3}Z$/, "Z"));
  url.searchParams.set("endDate", new Date(toMs).toISOString().replace(/\.\d{3}Z$/, "Z"));
  const map = new Map();
  readRows(await inLane("razedio", () => call("razedio", url))).forEach((r) => addRow(map, r));
  return map;
}

const cache = new Map();
const inflight = new Map();

/**
 * Map of lowercased username → { name, wagered } for everyone who wagered
 * under the code between fromMs and toMs. { fresh: true } skips the cache
 * (used for the draw itself).
 */
async function getWagers(casino, fromMs, toMs, opts) {
  checkWindow(casino, fromMs, toMs);
  const key = casino === "razed" ? "razed|" + JSON.stringify(razedDays(fromMs, toMs)) : "razedio|" + fromMs + "|" + toMs;
  const hit = cache.get(key);
  if (hit && !(opts && opts.fresh) && Date.now() - hit.at < FRESH_MS) return hit.map;
  let job = inflight.get(key);
  if (!job) {
    job = (casino === "razed" ? fetchRazed(fromMs, toMs) : fetchRazedio(fromMs, toMs)).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    const map = await job;
    cache.set(key, { at: Date.now(), map });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return map;
  } catch (err) {
    // The draw must not run on old numbers; everything else may
    if (hit && !(opts && opts.fresh)) {
      console.warn("[wager] %s: %s; using numbers from %ss ago", casino, err.message, Math.round((Date.now() - hit.at) / 1000));
      return hit.map;
    }
    throw err;
  }
}

/** Wager for one username in a window (0 if they don't appear). */
async function wagerOf(casino, username, fromMs, toMs, opts) {
  const map = await getWagers(casino, fromMs, toMs, opts);
  const row = map.get(String(username || "").toLowerCase());
  return row ? row.wagered : 0;
}

/**
 * Is this username playing under the code? Used when someone links an account.
 *   → { found, name (as the casino spells it), stillUnderCode, lookedBackDays }
 *
 * Razed.IO lists everyone on the code (even players who haven't bet), with
 * stillUnderCode, so one request answers it. Razed only lists players who
 * wagered in the window (45 days at most), so this looks back in 45-day steps
 * up to LOOK_BACK_DAYS; someone on the code who hasn't bet in that long can't
 * be confirmed (and wouldn't earn tickets anyway).
 */
const LOOK_BACK_DAYS = 180;
async function checkUnderCode(casino, username) {
  if (!CASINOS[casino]) throw new WagerError("Unknown casino.", 400);
  const key = String(username || "").toLowerCase();
  const to = Math.floor(Date.now() / 60000) * 60000;
  if (casino === "razedio") {
    const row = (await getWagers("razedio", to - 30 * DAY, to)).get(key);
    return { found: !!row, name: row ? row.name : null, stillUnderCode: row ? row.stillUnderCode !== false : null, lookedBackDays: null };
  }
  for (let back = 0; back < LOOK_BACK_DAYS; back += 44) {
    const end = to - back * DAY;
    const row = (await getWagers("razed", end - 44 * DAY, end)).get(key);
    if (row) return { found: true, name: row.name, stillUnderCode: null, lookedBackDays: back + 44 };
  }
  return { found: false, name: null, stillUnderCode: null, lookedBackDays: LOOK_BACK_DAYS };
}

module.exports = { CASINOS, WagerError, getWagers, wagerOf, checkWindow, checkUnderCode, configured, razedDays, RAZED_MAX_DAYS, LOOK_BACK_DAYS };
