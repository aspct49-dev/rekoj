/*
 * Wager raffles: everyone who wagers under the code on a casino during a
 * period is entered automatically; every `unit` dollars wagered is a ticket.
 * Separate from the join raffles in api.js (those need a linked account and
 * a click on Join). Modelled on kingkulbik's monthly wager raffle.
 *
 *   open      tickets counted live from the casino's affiliate figures
 *   locked    tickets frozen (fixed order) and the draw committed to a secret
 *             seed: its SHA-256 hash is public from this moment
 *   complete  every prize drawn; the seed is revealed so anyone can re-run
 *             the draws (the Verify button on the Raffles page)
 *
 * Fair draws: draw k takes one float from HMAC-SHA256(seed, `${id}:${k}:0`)
 * (first four bytes, base 256), picks ticket floor(float × tickets in play)
 * and the entry holding it wins, so odds are exactly tickets ÷ tickets in
 * play. Someone at the win cap leaves the pool for later draws. A reroll (the
 * winner couldn't take it) keeps the draw on the record, marked, removes that
 * player, and the replacement is simply the next draw from the same seed.
 * Entries are identified by their position in the frozen list, so the draws
 * can be re-checked from the public (masked) list.
 */
const crypto = require("crypto");
const store = require("./store");
const wager = require("./wager");

const DAY = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;

class InputError extends Error { constructor(m, status) { super(m); this.status = status || 400; } }
const bad = (m, s) => { throw new InputError(m, s); };

/* ---------------------------------------------------------------- the maths (mirrored in wager-raffle.js) */

const ticketsFor = (amount, unit) => (unit > 0 ? Math.floor(amount / unit + 1e-9) : 0);
const drawCount = (r) => (r.prizePerDraw > 0 ? Math.floor(r.prizePool / r.prizePerDraw + 1e-9) : 0);

/** Entries in a fixed, reproducible order: by name (lowercase), then amount. */
function freeze(rows, unit) {
  return rows
    .map((r) => ({ name: r.name, amount: round2(r.amount), tickets: ticketsFor(r.amount, unit) }))
    .filter((e) => e.tickets > 0)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || b.amount - a.amount);
}

function fairFloat(seed, id, k) {
  const b = crypto.createHmac("sha256", seed).update(id + ":" + k + ":0").digest();
  return b[0] / 256 + b[1] / 256 ** 2 + b[2] / 256 ** 3 + b[3] / 256 ** 4;
}

/** Who can still win (by position in the frozen list): under the win cap and not rerolled away. */
function eligible(entries, draws, maxWins) {
  const wins = new Map(), out = new Set();
  for (const d of draws) {
    if (d.rerolledAt) out.add(d.index); else wins.set(d.index, (wins.get(d.index) || 0) + 1);
  }
  return entries.map((e, index) => ({ e, index })).filter((x) => !out.has(x.index) && (wins.get(x.index) || 0) < maxWins);
}

/** Draw number `previous.length`. null when nobody can win any more. */
function drawNext(r, seed, previous) {
  const pool = eligible(r.entries, previous, r.maxWins);
  const total = pool.reduce((s, x) => s + x.e.tickets, 0);
  if (total <= 0) return null;
  const ticket = Math.min(total - 1, Math.floor(fairFloat(seed, r.id, previous.length) * total));
  let at = 0;
  for (const x of pool) {
    at += x.e.tickets;
    if (ticket < at) return { index: x.index, name: x.e.name, ticket, pool: total };
  }
  return null;
}

const kept = (draws) => draws.filter((d) => !d.rerolledAt);

/** "Sirsai" → "Sirs***" (the leaderboard's masking, site.js maskName). */
function mask(name) {
  const n = String(name || "");
  return n.length <= 4 ? n + "***" : n.slice(0, 4) + "***";
}

/* ---------------------------------------------------------------- live tickets */

/** Entries right now: frozen once locked, live from the casino while open. */
async function entriesOf(r, opts) {
  if (r.status !== "open") return r.entries;
  const now = Date.now();
  const to = Math.min(r.end, now);
  if (to <= r.start) return [];
  const map = await wager.getWagers(r.casino, r.start, to, opts);
  return freeze([...map.values()].map((x) => ({ name: x.name, amount: x.wagered })), r.unit);
}

function stateOf(r, now) {
  if (r.status === "complete") return "complete";
  if (r.status === "locked") return "locked";
  if (now < r.start) return "upcoming";
  return now < r.end ? "counting" : "ended";
}

/* ---------------------------------------------------------------- views */

/** For the Raffles page: masked names, odds, the viewer's own entry, no seed until complete. */
async function publicView(r, myCasinoName) {
  let entries, error = null;
  try { entries = await entriesOf(r); } catch (err) { entries = r.entries || []; error = "Live tickets are unavailable right now."; }
  const total = entries.reduce((s, e) => s + e.tickets, 0);
  const mineIdx = myCasinoName ? entries.findIndex((e) => e.name.toLowerCase() === myCasinoName.toLowerCase()) : -1;
  const mine = mineIdx >= 0 ? {
    name: entries[mineIdx].name, amount: entries[mineIdx].amount, tickets: entries[mineIdx].tickets,
    odds: total ? entries[mineIdx].tickets / total : 0, wins: kept(r.draws).filter((d) => d.index === mineIdx && r.status !== "open").length, index: mineIdx,
  } : null;
  return {
    id: r.id, title: r.title, thumb: r.thumb || null, casino: r.casino, casinoName: wager.CASINOS[r.casino].name,
    start: r.start, end: r.end, unit: r.unit, prizePool: r.prizePool, prizePerDraw: r.prizePerDraw, maxWins: r.maxWins,
    drawsTotal: drawCount(r), status: r.status, state: stateOf(r, Date.now()),
    entries: entries.map((e) => ({ name: mask(e.name), amount: e.amount, tickets: e.tickets, odds: total ? e.tickets / total : 0 })),
    totalTickets: total,
    draws: (r.draws || []).map((d) => ({ n: d.n, index: d.index, name: mask(d.name), ticket: d.ticket, pool: d.pool, prize: d.prize, at: d.at, rerolledAt: d.rerolledAt || null })),
    seedHash: r.seedHash || null, seed: r.status === "complete" ? r.seed : null,
    lockedAt: r.lockedAt || null, completedAt: r.completedAt || null,
    mine, error, updatedAt: Date.now(),
  };
}

/** For the admin panel: real names, live tickets, history. Never the seed while drawing. */
async function adminView(r) {
  let entries, error = null;
  try { entries = await entriesOf(r); } catch (err) { entries = r.entries || []; error = err.message; }
  const total = entries.reduce((s, e) => s + e.tickets, 0);
  return Object.assign({}, r, {
    seed: r.status === "complete" ? r.seed : null,
    casinoName: wager.CASINOS[r.casino].name, state: stateOf(r, Date.now()), drawsTotal: drawCount(r),
    // Can another prize be drawn? (false once everyone left has reached the win cap)
    canDraw: r.status === "locked" && kept(r.draws || []).length < drawCount(r) && !!drawNext(r, r.seed, r.draws || []),
    entries: entries.map((e) => Object.assign({}, e, { odds: total ? e.tickets / total : 0 })), totalTickets: total, error,
  });
}

/* ---------------------------------------------------------------- admin actions */

function monthWindow(now) {
  const d = new Date(now);
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

function num(v, label, min, max) {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n) || n < min || n > max) bad(label + " must be between " + min + " and " + max.toLocaleString("en-US") + ".");
  return n;
}

function applySettings(r, body) {
  const next = Object.assign({}, r);
  if ("title" in body) {
    next.title = String(body.title == null ? "" : body.title).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!next.title) bad("Give the raffle a title.");
  }
  if ("casino" in body) {
    if (!wager.CASINOS[body.casino]) bad("Pick Razed or Razed.IO.");
    next.casino = body.casino;
  }
  if ("unit" in body) next.unit = round2(num(body.unit, "Dollars per ticket", 1, 10000000));
  if ("prizePool" in body) next.prizePool = round2(num(body.prizePool, "Prize pool", 1, 10000000));
  if ("prizePerDraw" in body) next.prizePerDraw = round2(num(body.prizePerDraw, "Prize per draw", 1, 10000000));
  if ("maxWins" in body) next.maxWins = Math.round(num(body.maxWins, "Max wins per person", 1, 100));
  if ("start" in body) next.start = Date.parse(body.start) || bad("Pick when tickets start counting.");
  if ("end" in body) next.end = Date.parse(body.end) || bad("Pick when tickets stop counting.");
  if ("thumb" in body) {
    const t = String(body.thumb || "").trim();
    if (t && !/^https:\/\/[^\s"'<>]+$/i.test(t) && !/^\/api\/image\/[0-9a-f-]{36}$/.test(t) && !["wanted", "gates", "sweet-bonanza"].includes(t)) bad("Pick a picture, upload one, or paste an https:// image link.");
    next.thumb = t || null;
  }
  if (next.end <= next.start) bad("The end must be after the start.");
  if (next.prizePerDraw > next.prizePool) bad("The prize per draw can't be more than the pool.");
  try { wager.checkWindow(next.casino, next.start, next.end); } catch (err) { bad(err.message); }
  return next;
}

function log(r, type, by, detail) {
  r.history = [{ at: Date.now(), type, by: by || null, detail: detail || "" }].concat(r.history || []).slice(0, 200);
}

async function list() { return store.read("wagerRaffles"); }
async function find(id) {
  const r = (await list()).find((x) => x.id === id);
  if (!r) bad("That raffle doesn't exist any more.", 404);
  return r;
}
async function save(id, mutate) {
  return store.update("wagerRaffles", (all) => {
    const i = all.findIndex((x) => x.id === id);
    if (i < 0) bad("That raffle doesn't exist any more.", 404);
    const next = mutate(Object.assign({}, all[i]));
    all[i] = next;
    return { data: all, value: next };
  });
}

async function create(body, by) {
  const w = monthWindow(Date.now());
  const base = {
    id: store.newId(), title: "Monthly Wager Raffle", casino: "razed", start: w.start, end: w.end,
    unit: 1000, prizePool: 1000, prizePerDraw: 200, maxWins: 2, thumb: null,
    status: "open", entries: [], seed: null, seedHash: null, draws: [],
    createdAt: Date.now(), lockedAt: null, completedAt: null, history: [],
  };
  const r = applySettings(base, body || {});
  log(r, "created", by, wager.CASINOS[r.casino].name + ", $" + r.unit + " per ticket, " + drawCount(r) + " × $" + r.prizePerDraw);
  await store.update("wagerRaffles", (all) => { all.unshift(r); });
  return r;
}

async function edit(id, body, by) {
  return save(id, (r) => {
    if (r.status !== "open") bad("Unlock the raffle to change its settings.");
    const next = applySettings(r, body || {});
    log(next, "edited", by, "");
    return next;
  });
}

async function lock(id, by) {
  const current = await find(id);
  if (current.status !== "open") bad("This raffle is already locked.");
  let entries;
  try { entries = await entriesOf(current, { fresh: true }); } catch (err) { bad("Couldn't get the wager totals to lock with: " + err.message, 502); }
  if (!entries.length) bad("Nobody has a ticket yet.");
  const seed = crypto.randomBytes(32).toString("hex");
  return save(id, (r) => {
    if (r.status !== "open") bad("This raffle is already locked.");
    r.entries = entries;
    r.status = "locked";
    r.seed = seed;
    r.seedHash = crypto.createHash("sha256").update(seed).digest("hex");
    r.lockedAt = Date.now();
    log(r, "locked", by, entries.length + " players, " + entries.reduce((s, e) => s + e.tickets, 0) + " tickets");
    return r;
  });
}

async function unlock(id, by) {
  return save(id, (r) => {
    if (r.status !== "locked" || (r.draws || []).length) bad("Only a locked raffle with no draws can be unlocked.");
    Object.assign(r, { status: "open", entries: [], seed: null, seedHash: null, lockedAt: null });
    log(r, "unlocked", by, "");
    return r;
  });
}

/** Draw the next prize, or (with n) reroll draw n: its winner couldn't take it. */
async function draw(id, by, rerollN) {
  return save(id, (r) => {
    if (r.status !== "locked" || !r.seed) bad(r.status === "open" ? "Lock the raffle first." : "This raffle is finished.");
    let draws = (r.draws || []).slice();
    let prize = r.prizePerDraw;
    if (rerollN !== undefined) {
      const target = draws.find((d) => d.n === Number(rerollN));
      if (!target) bad("That draw doesn't exist.");
      if (target.rerolledAt) bad("That draw was already rerolled.");
      draws = draws.map((d) => (d.n === target.n ? Object.assign({}, d, { rerolledAt: Date.now() }) : d));
      prize = target.prize;
    } else if (kept(draws).length >= drawCount(r)) {
      bad("Every prize has been drawn. Finish the raffle to reveal the seed.");
    }
    const next = drawNext(r, r.seed, draws);
    if (!next) bad(rerollN !== undefined ? "Nobody is left who can win." : "Everyone left has reached the win cap. Finish the raffle.");
    draws.push({ n: draws.length, index: next.index, name: next.name, ticket: next.ticket, pool: next.pool, prize, at: Date.now() });
    r.draws = draws;
    log(r, rerollN !== undefined ? "rerolled" : "drew", by, (rerollN !== undefined ? "Draw " + (Number(rerollN) + 1) + " rerolled → " : "") + next.name + " ($" + prize + ")");
    return r;
  });
}

async function finish(id, by) {
  return save(id, (r) => {
    if (r.status !== "locked" || !r.seed) bad("Only a raffle being drawn can be finished.");
    if (kept(r.draws || []).length < drawCount(r) && drawNext(r, r.seed, r.draws || [])) bad("There are prizes left to draw.");
    r.status = "complete";
    r.completedAt = Date.now();
    log(r, "finished", by, "Seed revealed");
    return r;
  });
}

async function remove(id, by) {
  await store.update("wagerRaffles", (all) => ({ data: all.filter((x) => x.id !== id) }));
}

module.exports = {
  InputError, list, find, create, edit, lock, unlock, draw, finish, remove,
  publicView, adminView, stateOf, _test: { freeze, drawNext, fairFloat, eligible, ticketsFor, drawCount, mask },
};
