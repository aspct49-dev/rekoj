/*
 * Leaderboard standings, and every finished month's winners.
 *
 * fetchStandings() asks a casino's affiliate API for a month's top places
 * (api/leaderboard.js serves it live). Each month ends at 21:00 Paris time
 * (data.js), and its final standings are kept in leaderboardArchive:
 *
 *   Razed     counts whole UTC days, so asking afterwards would add the
 *             evening after the end. Instead, in the last 15 minutes the live
 *             board saves what it shows (leaderboardLive), and the last of
 *             those, taken within a minute or two of the end, is the result.
 *             If nobody had the board open then, the API's totals are used
 *             (they then include the rest of that UTC day; the admin panel
 *             says so).
 *   Razed.IO  counts to the second: 5 minutes after the end, the exact
 *             window is fetched.
 *
 * Recording happens on the first leaderboard request after that, from the
 * daily cron, or from the admin panel (which can also re-record or remove a
 * month). The names stay in full for the admin panel; the public list is
 * masked.
 *
 * The next month starts the moment the last one ends, on Razed too: a Razed
 * month counts from the next UTC midnight, plus each player's "carry", what
 * they wagered on the last day after 21:00. At the end the live board also
 * saves everyone's total for that day (leaderboardLive.razedDay), so the
 * carry is that day's final total minus what they had at 21:00. Without that
 * capture, the carry is worked out for the top places kept at the end (their
 * month total now minus the kept one). Once the day is over the carry is
 * fixed and saved (leaderboardCarry).
 */
const CONFIG = require("../data.js").REKOJ_CONFIG;
const store = require("./store");

const TIMEOUT_MS = 8000;
const SNAPSHOT_FROM = 15 * 60 * 1000; // save the live standings this long before the end
const SNAPSHOT_FINAL = 10 * 60 * 1000; // a snapshot this close to the end is the result
const RAZEDIO_SETTLE = 5 * 60 * 1000;
const DAY = 86400000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoSecond = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/* ---------------------------------------------------------------- fetching */

/** First value present under any of `keys`. */
function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

/**
 * Field names are read loosely on purpose: a rename upstream should cost a
 * field, not the whole board. Avatars are deliberately not taken from the
 * API: every place shows the character it has in the design.
 */
function commonRow(row) {
  return {
    name: pick(row, ["masked_username", "maskedUsername", "username", "name", "player", "nickname"]),
    wagered: Number(pick(row, ["wagered", "wager", "wagered_amount", "total_wagered", "totalWagered", "amount", "turnover"])) || 0,
  };
}

const FLAVOURS = {
  /*
   * razed.com — GET /player/api/v1/referrals/leaderboard
   *   ?referral_code=rekoj&from=2026-11-01&to=2026-12-01&top=10
   * Note the singular `referral_code`; the plural form 404s. Whole UTC days,
   * and `to` is exclusive, so the day after the month's last day is sent.
   * Answers with { total, from, to, data: [ { username, referred_by_code, wagered } ] }
   */
  razed: {
    url: "https://api.razed.com/player/api/v1/referrals/leaderboard",
    keyEnv: ["REFERRAL_KEY", "API_KEY"],
    header: "X-Referral-Key",
    params(url, { code, season }) {
      url.searchParams.set("referral_code", code);
      url.searchParams.set("from", season.firstDay);
      url.searchParams.set("to", isoDay(Math.floor(season.end / DAY) * DAY + DAY));
      url.searchParams.set("top", String(season.places));
    },
    rows: (json) => (Array.isArray(json) ? json : (json && json.data) || []),
    row: commonRow,
  },

  /*
   * razed.io — GET /externals/affiliates?codes=rekoj&startDate=…Z&endDate=…Z
   * Answers with a bare array of { id, username, avatar, wagered, deposited, stillUnderCode }.
   * Dates need an explicit offset, amounts are decimal strings, and players
   * who have since moved to another code come back with stillUnderCode:false
   * (their wagering under this code still counts, so they are kept).
   */
  razedio: {
    url: "https://api.razed.io/externals/affiliates",
    keyEnv: ["API_KEY", "REFERRAL_KEY"],
    header: "x-api-key",
    params(url, { code, season }) {
      url.searchParams.set("codes", code);
      url.searchParams.set("startDate", isoSecond(season.start));
      url.searchParams.set("endDate", isoSecond(season.end));
    },
    rows: (json) => (Array.isArray(json) ? json : (json && json.data) || []),
    row: commonRow,
  },
};

/** Envvar prefix per board: razed -> RAZED_, razedio -> RAZEDIO_ */
const envPrefix = (key) => key.toUpperCase().replace(/[^A-Z0-9]/g, "") + "_";

function flavourOf(key) {
  const board = CONFIG.boards[key];
  return board && FLAVOURS[board.apiFlavor || key];
}

function secretOf(key) {
  const flavour = flavourOf(key);
  return flavour ? flavour.keyEnv.map((name) => process.env[envPrefix(key) + name]).find(Boolean) || null : null;
}

class StandingsError extends Error {
  constructor(message, status) { super(message); this.status = status || 502; }
}

/** One request to a board's API, set up by setParams(url, code): [{ name, wagered }] with wagering only. */
async function requestRows(key, setParams) {
  const board = CONFIG.boards[key];
  const flavour = flavourOf(key);
  const secret = secretOf(key);
  if (!flavour) throw new StandingsError("No API flavour for " + key, 500);
  if (!secret) throw new StandingsError("Leaderboard key not configured for " + key, 503);
  const code = process.env[envPrefix(key) + "REFERRAL_CODE"] || board.referralCode || CONFIG.code.toLowerCase();
  const url = new URL(process.env[envPrefix(key) + "API_URL"] || flavour.url);
  setParams(url, code, flavour);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  const request = () => fetch(url, { headers: { [flavour.header]: secret, Accept: "application/json" }, signal: abort.signal });
  try {
    let r = await request();
    if (r.status === 429) {
      // Rate limited (Razed.IO: 1 request/second). Wait it out once.
      await sleep(1100);
      r = await request();
    }
    const body = await r.text();
    if (!r.ok) {
      // Report the status, never the key or the full request URL.
      console.error("[leaderboard] %s upstream %s: %s", key, r.status, body.slice(0, 300));
      throw new StandingsError("Upstream error " + r.status);
    }
    let json;
    try { json = JSON.parse(body); } catch (e) { throw new StandingsError("Upstream did not return JSON"); }
    // Razed.IO returns everyone who clicked the code, including players who
    // have wagered nothing; only actual wagering makes the board.
    return flavour.rows(json)
      .map(flavour.row)
      .filter((e) => e.name && e.wagered > 0)
      .map((e) => ({ name: String(e.name), wagered: e.wagered }));
  } catch (err) {
    if (err instanceof StandingsError) throw err;
    throw new StandingsError(err && err.name === "AbortError" ? "Upstream timed out" : "Upstream unreachable", 504);
  } finally {
    clearTimeout(timer);
  }
}

const top = (rows, places) => rows.sort((a, b) => b.wagered - a.wagered).slice(0, places);

/** Everyone's Razed total over whole UTC days [from, to): { name: wagered }. */
async function razedTotals(from, to) {
  const out = {};
  for (let page = 1; page <= 20; page++) {
    const rows = await requestRows("razed", (url, code) => {
      url.searchParams.set("referral_code", code);
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
      url.searchParams.set("top", "100");
      url.searchParams.set("page", String(page));
    });
    rows.forEach((r) => { out[r.name] = (out[r.name] || 0) + r.wagered; });
    if (rows.length < 100) break;
    await sleep(300);
  }
  return out;
}

const midnight = (day) => Date.parse(day + "T00:00:00Z");
/** A Razed month that starts mid-day (21:00) has a carry from that day's evening. */
const hasCarry = (key, season) => key === "razed" && season.start < midnight(season.firstDay);

const carryMemo = new Map();

/** What each player wagered on Razed after the month started, before its first UTC midnight: { name: amount }. */
async function carryFor(season) {
  if (carryMemo.has(season.id)) return carryMemo.get(season.id).players;
  const kept = (await store.read("leaderboardCarry"))[season.id];
  if (kept) { carryMemo.set(season.id, kept); return kept.players; }

  const now = Date.now(), dayStart = isoDay(season.start);
  const players = {};
  let source = "none";
  const live = (await store.read("leaderboardLive")).razedDay;
  if (live && live.month === season.id && live.at <= season.start && live.at >= season.start - SNAPSHOT_FINAL) {
    // Everyone's total for the day at 21:00 was saved: the carry is the rest of the day
    const day = await razedTotals(dayStart, season.firstDay);
    for (const [name, total] of Object.entries(day)) {
      const c = total - (live.players[name] || 0);
      if (c >= 0.005) players[name] = c;
    }
    source = "day";
  } else {
    // Only the top places kept at the end: their month total now minus the kept one
    const prev = CONFIG.previous(season);
    const rec = (await store.read("leaderboardArchive")).find((r) => r.id === prev.id && r.board === "razed" && r.source === "snapshot" && !r.removed);
    if (rec) {
      const totals = await razedTotals(prev.firstDay, season.firstDay);
      for (const e of rec.entries) {
        const c = (totals[e.name] || 0) - e.wagered;
        if (c >= 0.005) players[e.name] = c;
      }
      source = "top";
    }
  }
  // Once the day is over (and Razed's totals have settled), the carry is final
  if (now >= midnight(season.firstDay) + 10 * 60 * 1000) {
    const rec = { source, players, at: now };
    await store.update("leaderboardCarry", (d) => { if (!d[season.id]) d[season.id] = rec; });
    carryMemo.set(season.id, rec);
  }
  return players;
}

/** The month's top places, most wagered first: [{ name, wagered }]. */
async function fetchStandings(key, season) {
  if (hasCarry(key, season)) {
    // From the first UTC midnight (if it has passed), plus the evening before it
    const [month, carry] = await Promise.all([
      Date.now() < midnight(season.firstDay) ? {} : razedTotals(season.firstDay, isoDay(Math.floor(season.end / DAY) * DAY + DAY)),
      carryFor(season),
    ]);
    const sum = Object.assign({}, month);
    for (const [name, c] of Object.entries(carry)) sum[name] = (sum[name] || 0) + c;
    return top(Object.entries(sum).map(([name, wagered]) => ({ name, wagered })), season.places);
  }
  const flavour = flavourOf(key);
  const rows = await requestRows(key, (url, code) => flavour.params(url, { code, season }));
  return top(rows, season.places);
}

/* ---------------------------------------------------------------- recording */

const firstMonth = () => CONFIG.schedule.firstMonth || "0000-00";
const keyOf = (r) => r.id + "|" + r.board;

/**
 * Called with every fresh live answer: in the last 15 minutes, keep it. On
 * Razed, also keep everyone's total for the last day, so the next month can
 * start at 21:00 exactly (see carryFor).
 */
async function noteLive(key, season, entries, now = Date.now()) {
  const left = season.end - now;
  if (left <= 0 || left > SNAPSHOT_FROM) return false;
  const next = CONFIG.season(key, season.end);
  const day = hasCarry(key, next) ? await razedTotals(isoDay(next.start), next.firstDay).catch(() => null) : null;
  await store.update("leaderboardLive", (d) => {
    const had = d[key];
    if (!(had && had.month === season.id && had.at >= now)) d[key] = { month: season.id, at: now, entries };
    if (day && !(d.razedDay && d.razedDay.month === next.id && d.razedDay.at >= now)) d.razedDay = { month: next.id, at: now, players: day };
  });
  return true;
}

/** Work out and save one board's final standings for a finished month. */
async function record(key, season, opts = {}) {
  const now = Date.now();
  if (now < season.end) throw Object.assign(new Error(season.name + " hasn't ended yet."), { status: 400 });
  let entries = null, source = "api", at = now;
  if (key === "razed" && !opts.refetch) {
    const snap = (await store.read("leaderboardLive"))[key];
    if (snap && snap.month === season.id && snap.at >= season.end - SNAPSHOT_FINAL && snap.at <= season.end) {
      entries = snap.entries;
      source = "snapshot";
      at = snap.at;
    }
  }
  if (!entries) {
    entries = await fetchStandings(key, season);
    // Razed's totals run to the end of the UTC day, past 21:00
    if (key === "razed") source = "api-day";
  }
  const rec = {
    id: season.id, board: key, name: season.name, start: season.start, end: season.end,
    prizes: season.prizes, entries, source, standingsAt: at, recordedAt: now, by: opts.by || "auto",
  };
  return store.update("leaderboardArchive", (list) => {
    const i = list.findIndex((r) => keyOf(r) === keyOf(rec));
    if (i !== -1 && !opts.replace) return { value: list[i] };
    if (i !== -1) list.splice(i, 1);
    list.push(rec);
    list.sort((a, b) => b.end - a.end || a.board.localeCompare(b.board));
    return { data: list, value: rec };
  });
}

// Per warm instance: months known to be recorded, and when to look again.
const done = new Set();
const notBefore = new Map();

/** Record last month for `key` if it has ended and isn't kept yet. Cheap once done. */
async function ensure(key, now = Date.now()) {
  const prev = CONFIG.previous(CONFIG.season(key, now));
  if (prev.id < firstMonth()) return null;
  const tag = prev.id + "|" + key;
  if (done.has(tag) || now < (notBefore.get(tag) || 0)) return null;
  const ready = prev.end + (key === "razedio" ? RAZEDIO_SETTLE : 0);
  if (now < ready) { notBefore.set(tag, ready); return null; }
  if ((await store.read("leaderboardArchive")).some((r) => r.id === prev.id && r.board === key)) {
    done.add(tag);
    return null;
  }
  try {
    const rec = await record(key, prev);
    done.add(tag);
    console.log("[leaderboard] recorded %s %s (%s)", key, prev.id, rec.source);
    return rec;
  } catch (err) {
    notBefore.set(tag, now + 60 * 1000); // try again in a minute
    console.error("[leaderboard] recording %s %s failed: %s", key, prev.id, err.message);
    return null;
  }
}

const ensureAll = (now) => Promise.all(Object.keys(CONFIG.boards).map((key) => ensure(key, now)));

/* ---------------------------------------------------------------- reading */

const mask = (name) => (!CONFIG.maskNames || !name ? name || "" : String(name).slice(0, 4) + "***");

/** Finished months, newest first, both boards each: [{ id, name, start, end, boards: { razed: { prizes, pool, entries } } }] */
async function publicList() {
  const months = new Map();
  for (const r of await store.read("leaderboardArchive")) {
    if (r.removed) continue;
    if (!months.has(r.id)) months.set(r.id, { id: r.id, name: r.name, start: r.start, end: r.end, boards: {} });
    months.get(r.id).boards[r.board] = {
      prizes: r.prizes,
      pool: r.prizes.reduce((a, b) => a + b, 0),
      entries: r.entries.map((e) => ({ name: mask(e.name), wagered: e.wagered })),
    };
  }
  return [...months.values()].sort((a, b) => b.end - a.end);
}

/** Everything the admin panel shows: each board's month, its live snapshot, and every record in full. */
async function adminView(now = Date.now()) {
  const [list, live, carries] = await Promise.all([store.read("leaderboardArchive"), store.read("leaderboardLive"), store.read("leaderboardCarry")]);
  const boards = Object.keys(CONFIG.boards).map((key) => {
    const cur = CONFIG.season(key, now), prev = CONFIG.previous(cur);
    const snap = live[key];
    return {
      key, name: CONFIG.boards[key].name, configured: !!secretOf(key),
      current: { id: cur.id, name: cur.name, start: cur.start, end: cur.end, prizes: cur.prizes, pool: cur.pool },
      previous: prev.id < firstMonth() ? null : {
        id: prev.id, name: prev.name, end: prev.end,
        recorded: list.some((r) => r.id === prev.id && r.board === key && !r.removed),
      },
      snapshot: snap ? { month: snap.month, at: snap.at, places: snap.entries.length } : null,
      carry: carries[cur.id] && hasCarry(key, cur) ? {
        source: carries[cur.id].source, from: cur.start,
        players: Object.keys(carries[cur.id].players).length,
        total: Object.values(carries[cur.id].players).reduce((a, b) => a + b, 0),
      } : null,
    };
  });
  return { boards, records: list.filter((r) => !r.removed) };
}

/** Admin: record a finished month (refetch: ask the API again rather than use the end-of-month snapshot). */
function adminRecord(key, id, by, refetch) {
  if (!CONFIG.boards[key]) throw Object.assign(new Error("Unknown board."), { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(String(id)) || id < firstMonth()) throw Object.assign(new Error("Pick a month the board ran."), { status: 400 });
  const season = CONFIG.month(key, id);
  done.delete(id + "|" + key);
  return record(key, season, { replace: true, refetch: !!refetch, by });
}

/** Admin: take a month off the site. A marker stays so it isn't recorded again automatically. */
function adminRemove(key, id, by) {
  return store.update("leaderboardArchive", (list) => {
    const r = list.find((x) => x.id === id && x.board === key && !x.removed);
    if (!r) throw Object.assign(new Error("That month isn't kept."), { status: 404 });
    r.removed = true;
    r.removedAt = Date.now();
    r.removedBy = by;
    r.entries = [];
  });
}

module.exports = {
  FLAVOURS, StandingsError, fetchStandings, secretOf, flavourOf, carryFor,
  noteLive, record, ensure, ensureAll, publicList, adminView, adminRecord, adminRemove,
  SNAPSHOT_FROM, SNAPSHOT_FINAL,
};
