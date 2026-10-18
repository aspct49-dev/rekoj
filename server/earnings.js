/*
 * Wager points: players with an approved casino link earn Rekoj points for
 * what they wager under the code, credited into their BotRix balance.
 *
 * Rules live in content.js (earn.wager): every `per` dollars wagered in a
 * calendar month (UTC) pays `points`. Wager counts from the later of the day
 * the link was approved and earn.startsOn, so nobody is paid for wagering
 * from before they joined or before the program started.
 *
 * Crediting is idempotent. Per player and month the ledger ("earnings" table)
 * keeps what has been credited; a run works out what's owed now, reserves
 * the difference in the ledger first (an atomic update, so two runs can't
 * both pay it), then asks BotRix to add it, and gives the reservation back if
 * BotRix refuses. Runs happen when a player opens their profile or the store,
 * from the admin panel, and once a day from Vercel Cron.
 */
const store = require("./store");
const botrix = require("./botrix");
const wager = require("./wager");
const CONTENT = require("../content.js").REKOJ_CONTENT;

const DAY = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;

function rules() { return (CONTENT.earn && CONTENT.earn.wager) || {}; }
/** Wager before this never earns points (content.js earn.startsOn). */
function programStart() { return Date.parse(((CONTENT.earn && CONTENT.earn.startsOn) || "1970-01-01") + "T00:00:00Z") || 0; }
function monthKey(ms) { return new Date(ms).toISOString().slice(0, 7); }
function monthStart(ms) { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
function nextMonth(ms) { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }

/** The months a player could be owed for right now: last month (it may have just closed) and this month. */
function monthsToCheck(startMs, now) {
  const out = [];
  for (const m of [monthStart(monthStart(now) - 1), monthStart(now)]) {
    const from = Math.max(m, startMs);
    const to = Math.min(nextMonth(m), now);
    if (to > from) out.push({ key: monthKey(m), from, to });
  }
  return out;
}

const pointsFor = (rule, wagered) => Math.floor((wagered + 1e-9) / rule.per) * rule.points;

/** Approved links that earn points: { userId, kickName, casino, username, since } */
async function earners() {
  const links = await store.read("links");
  const r = rules();
  return links
    .filter((l) => l.status === "approved" && r[l.casino] && r[l.casino].per > 0 && r[l.casino].points > 0)
    .map((l) => ({ userId: l.userId, kickName: l.kickName, casino: l.casino, username: l.username, since: Math.max(l.decidedAt || l.requestedAt, programStart()) }));
}

/** What each month is worth for one earner (wager and points), without paying anything. */
async function owed(e, now) {
  const rule = rules()[e.casino];
  const out = [];
  for (const m of monthsToCheck(e.since, now)) {
    const wagered = round2(await wager.wagerOf(e.casino, e.username, m.from, m.to));
    out.push({ key: m.key, casino: e.casino, wagered, earned: pointsFor(rule, wagered) });
  }
  return out;
}

async function logPoints(entry) {
  try {
    await store.update("pointsLog", (log) => {
      log.unshift(Object.assign({ at: Date.now() }, entry));
      if (log.length > 1000) log.length = 1000;
    });
  } catch (err) { console.warn("[earn] couldn't log:", err.message); }
}

/** Pay one earner whatever is owed. → [{ key, casino, delta }] paid, or throws nothing (errors are reported per month). */
async function creditOne(e, now, by) {
  const months = await owed(e, now);
  const paid = [], problems = [];
  for (const m of months) {
    const slot = e.casino + ":" + m.key;
    // Reserve the difference first so a parallel run can't pay it too
    const delta = await store.update("earnings", (all) => {
      const rec = all[e.userId] || (all[e.userId] = { kickName: e.kickName, months: {} });
      rec.kickName = e.kickName;
      const cur = rec.months[slot] || (rec.months[slot] = { credited: 0 });
      cur.wagered = m.wagered;
      cur.checkedAt = now;
      const d = m.earned - cur.credited;
      if (d > 0) cur.credited += d;
      return { data: all, value: Math.max(0, d) };
    });
    if (!delta) continue;
    try {
      await botrix.adjustPoints(e.kickName, delta);
      paid.push({ key: m.key, casino: e.casino, delta, wagered: m.wagered });
      await logPoints({ by: by || "auto", name: e.kickName, delta, reason: "Wager points: " + wager.CASINOS[e.casino].name + " " + m.key + " ($" + m.wagered.toLocaleString("en-US") + " wagered)" });
    } catch (err) {
      // Give the reservation back; it's tried again next run
      await store.update("earnings", (all) => { all[e.userId].months[slot].credited -= delta; }).catch(() => {});
      problems.push(m.key + ": " + err.message);
    }
  }
  return { paid, problems };
}

/** Pay everyone who's owed (admin button, daily cron). */
async function creditAll(by) {
  const now = Date.now();
  const list = await earners();
  const summary = { players: list.length, paid: 0, points: 0, problems: [] };
  for (const e of list) {
    try {
      const r = await creditOne(e, now, by);
      if (r.paid.length) summary.paid++;
      summary.points += r.paid.reduce((s, p) => s + p.delta, 0);
      r.problems.forEach((p) => summary.problems.push(e.kickName + " " + p));
    } catch (err) {
      summary.problems.push(e.kickName + ": " + err.message);
    }
  }
  await store.update("earnings", (all) => { all._lastRun = { at: now, by: by || "auto", ...summary }; }).catch(() => {});
  return summary;
}

// One automatic run per player per few minutes is plenty (each run asks the casino and BotRix)
const recent = new Map();

/**
 * A player's wager points: pays what's owed (at most every few minutes), then
 * reports this month's progress. → { rules, linked, months: [...], since }
 */
async function forUser(userId, opts) {
  const now = Date.now();
  const mine = (await earners()).filter((e) => e.userId === userId);
  if (!mine.length) return { rules: rules(), linked: false, months: [] };
  const auto = !(opts && opts.noCredit) && now - (recent.get(userId) || 0) > 5 * 60 * 1000;
  let problems = [];
  if (auto) {
    recent.set(userId, now);
    for (const e of mine) {
      try { problems = problems.concat((await creditOne(e, now, "auto")).problems); } catch (err) { problems.push(err.message); }
    }
  }
  const ledger = (await store.read("earnings"))[userId] || { months: {} };
  const months = [];
  for (const e of mine) {
    const rule = rules()[e.casino];
    let current;
    try { current = (await owed(e, now)).find((m) => m.key === monthKey(now)); } catch (err) { problems.push(err.message); }
    const w = current ? current.wagered : (ledger.months[e.casino + ":" + monthKey(now)] || {}).wagered || 0;
    const credited = (ledger.months[e.casino + ":" + monthKey(now)] || {}).credited || 0;
    months.push({
      casino: e.casino, casinoName: wager.CASINOS[e.casino].name, username: e.username, since: e.since,
      month: monthKey(now), wagered: w, credited,
      nextAt: (Math.floor(w / rule.per) + 1) * rule.per, per: rule.per, points: rule.points,
    });
  }
  return { rules: rules(), linked: true, months, problems };
}

/** For the admin panel: totals per player and the last run. */
async function overview() {
  const all = await store.read("earnings");
  const players = Object.entries(all).filter(([k]) => !k.startsWith("_")).map(([userId, rec]) => {
    const months = Object.entries(rec.months || {}).map(([slot, m]) => ({ slot, ...m }));
    return { userId, kickName: rec.kickName, credited: months.reduce((s, m) => s + (m.credited || 0), 0), months };
  }).sort((a, b) => b.credited - a.credited);
  return { rules: rules(), lastRun: all._lastRun || null, players };
}

module.exports = { creditAll, forUser, overview, monthsToCheck, pointsFor };
