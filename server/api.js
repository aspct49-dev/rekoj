/*
 * Every /api/* route except the leaderboard (api/leaderboard.js).
 *
 * Public
 *   GET  /api/me                        who's signed in, their points, admin or not
 *   GET  /api/store                     store items on sale
 *   GET  /api/raffles                   active and past raffles
 *   GET  /api/overlay/raffle?id=        a raffle for the stream overlay
 *   GET  /api/overlay/alerts            latest store redemptions, for the alert overlay
 *   POST /api/contact        {name, reply, topic, message, website, startedAt}   the contact form
 *   GET  /api/image/<id>                a picture uploaded in the admin panel
 * Signed in
 *   POST /api/store/redeem   {itemId}   spend points on an item (an order an admin fulfils)
 *   GET  /api/raffles/mine              your linked casino accounts and tickets in open raffles
 *   POST /api/raffles/join   {id}       enter a raffle (needs an approved link for its casino)
 *   GET  /api/me/activity               your orders, raffle entries, wins and links
 *   POST /api/me/links       {casino, username}   ask to link a casino username
 *   POST /api/me/links/cancel {casino}            withdraw a request still waiting
 * Admin (Kick usernames in ADMIN_KICK_USERNAMES)
 *   GET  /api/admin/overview
 *   GET  /api/admin/store               POST /api/admin/store         {item}  create or update
 *                                       POST /api/admin/store/delete  {id}
 *   GET  /api/admin/redemptions         POST /api/admin/redemptions   {id, action: fulfil|reject, note}
 *   GET  /api/admin/raffles             POST /api/admin/raffles       {raffle} create or update
 *   GET  /api/admin/raffles/stats       live entries/tickets per raffle
 *   GET  /api/admin/raffles/detail?id=  one raffle: entries with tickets, draws, activity
 *   GET  /api/admin/raffles/entries?id= POST /api/admin/raffles/delete {id}
 *   GET  /api/admin/raffles/log         POST /api/admin/raffles/draw  {id}
 *                                       POST /api/admin/raffles/end   {id}       end it now
 *                                       POST /api/admin/raffles/duplicate {id}   copy with no entries
 *                                       POST /api/admin/raffles/remove-entry {id, userId, reason}
 *                                       POST /api/admin/raffles/reinstate {id, userId}
 *   GET  /api/admin/links               POST /api/admin/links         {id, action: approve|reject|unlink, note, force}
 *                                       POST /api/admin/links/manual  {kick, casino, username, force}
 *                                       POST /api/admin/links/check   {id}   look it up under the code again
 *   GET  /api/admin/messages            POST /api/admin/messages      {id, action: done|reopen|delete}
 *   POST /api/admin/images              {data: data-URL}  upload a picture → {url}
 *   GET  /api/admin/users
 *   GET  /api/admin/points?name=        POST /api/admin/points        {name, delta, reason}
 * Auth: see kick.js.
 *
 * Wager raffles: a viewer links their casino username (an admin approves it),
 * joins a raffle, and gets tickets for what they wager under the code between
 * the raffle's wagerFrom and endsAt: every `perDollars` wagered gives
 * `ticketsPer` tickets, from `minWager` up, capped at `maxTickets` (0 = no cap).
 * The draw picks winners weighted by tickets.
 */
const crypto = require("crypto");
const { json, readJson, sameOrigin } = require("./http");
const { readSession, isAdmin } = require("./session");
const store = require("./store");
const botrix = require("./botrix");
const kick = require("./kick");
const wager = require("./wager");

const TIERS = ["gold", "red", "purple", "blue"];
const CASINO_IDS = Object.keys(wager.CASINOS);
const DAY = 86400000;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
const CODE = require("../data.js").REKOJ_CONFIG.code;

/* ---------------------------------------------------------------- shapes */

function isUrl(v) { return /^https:\/\/[^\s"'<>]+$/i.test(String(v || "")) || isUploaded(v); }
/** A picture uploaded in the admin panel, served by this site. */
function isUploaded(v) { return /^\/api\/image\/[0-9a-f-]{36}$/.test(String(v || "")); }
const round2 = (n) => Math.round(n * 100) / 100;

function raffleState(r, now) {
  if (r.status === "drawn") return "drawn";
  return Date.parse(r.endsAt) > now ? "open" : "ended";
}

/** A raffle's ticket rules, with defaults for raffles saved before they existed. */
function rulesOf(r) {
  return {
    casino: CASINO_IDS.includes(r.casino) ? r.casino : "razed",
    wagerFrom: r.wagerFrom || new Date(Math.min(r.createdAt || Date.now(), (Date.parse(r.endsAt) || Infinity) - DAY)).toISOString(),
    perDollars: Number(r.perDollars) > 0 ? Number(r.perDollars) : 100,
    ticketsPer: Number(r.ticketsPer) > 0 ? Math.round(Number(r.ticketsPer)) : 1,
    minWager: Math.max(0, Number(r.minWager) || 0),
    maxTickets: Math.max(0, Math.round(Number(r.maxTickets) || 0)),
  };
}

function ticketsFor(rules, wagered) {
  if (!(wagered > 0) || wagered < rules.minWager) return 0;
  let t = Math.floor(wagered / rules.perDollars + 1e-9) * rules.ticketsPer;
  if (rules.maxTickets) t = Math.min(t, rules.maxTickets);
  return t;
}

/** What anyone may see about a raffle (never who entered). */
function publicRaffle(r, user, now) {
  const state = raffleState(r, now);
  const rules = rulesOf(r);
  return Object.assign({
    id: r.id, game: r.game, prize: r.prize, value: r.value, winners: r.winners, thumb: r.thumb,
    endsAt: r.endsAt, state,
    entries: (r.entries || []).length + (r.seedEntries || 0),
    entered: !!(user && (r.entries || []).some((e) => e.userId === user.id)),
    winnersList: state === "drawn" ? (r.winnersList || []).map((w) => w.username) : [],
    totalTickets: state === "drawn" ? r.totalTickets || null : null,
    drawnAt: r.drawnAt || null,
    casinoName: wager.CASINOS[rules.casino].name,
  }, rules);
}

function publicItem(i) {
  return { id: i.id, name: i.name, cost: i.cost, tier: i.tier, image: i.image, stock: i.stock };
}

function publicLink(l) {
  return l ? { casino: l.casino, username: l.username, status: l.status, note: l.note || "", requestedAt: l.requestedAt, decidedAt: l.decidedAt || null } : null;
}

/* ---------------------------------------------------------------- helpers */

function requireUser(req) {
  const user = readSession(req);
  if (!user) fail(401, "Sign in with Kick first.");
  return user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (!isAdmin(user)) fail(403, "Admins only.");
  return user;
}

async function logPoints(entry) {
  try {
    await store.update("pointsLog", (log) => {
      log.unshift(Object.assign({ at: Date.now() }, entry));
      if (log.length > 1000) log.length = 1000;
    });
  } catch (err) {
    console.warn("[points] couldn't log:", err.message);
  }
}

/** "Title · Subtitle", leaving out a subtitle that only repeats the title (same rule as site.js). */
function raffleLabel(r) {
  const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  const sub = words(r.prize), title = words(r.game);
  return r.game + (sub.length && !sub.every((w) => title.includes(w)) ? " · " + String(r.prize).trim() : "");
}

/** Raffle activity for the admin panel: created, edited, joined, drawn, … */
async function logRaffle(r, type, by, detail) {
  try {
    await store.update("raffleLog", (log) => {
      log.unshift({ at: Date.now(), raffleId: r.id, game: raffleLabel(r), type, by: by || null, detail: detail || "" });
      if (log.length > 2000) log.length = 2000;
    });
  } catch (err) {
    console.warn("[raffles] couldn't log:", err.message);
  }
}

// A double click shouldn't act twice (per instance; the data checks still guard)
const lastAction = new Map();
function throttle(key, ms) {
  const now = Date.now();
  if (now - (lastAction.get(key) || 0) < ms) fail(429, "One moment…");
  lastAction.set(key, now);
}

function cleanText(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
function cleanInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}
function cleanNum(v, min, max) {
  const n = round2(Number(v));
  if (v === "" || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max) return null;
  return n;
}
function cleanCasinoName(v) {
  const name = String(v == null ? "" : v).trim();
  if (!/^[A-Za-z0-9_.\-]{2,32}$/.test(name)) fail(400, "Enter your username exactly as it shows on the casino (letters, numbers, _ . -).");
  return name;
}
function cleanCasino(v) {
  if (!CASINO_IDS.includes(v)) fail(400, "Pick Razed or Razed.IO.");
  return v;
}

/** { razed: link|null, razedio: link|null } for one user (current links only). */
function linksFor(links, userId) {
  const out = {};
  CASINO_IDS.forEach((c) => { out[c] = links.find((l) => l.userId === userId && l.casino === c) || null; });
  return out;
}

/** Someone else already holds (or is asking for) this casino username. */
function takenBy(links, casino, username, userId) {
  const key = username.toLowerCase();
  return links.find((l) => l.casino === casino && l.username.toLowerCase() === key && l.userId !== userId && (l.status === "approved" || l.status === "pending"));
}

/**
 * The entries of a raffle with each one's wager and tickets right now. Only
 * an approved link counts: someone unlinked after joining has no tickets.
 */
async function entriesWithTickets(r, opts) {
  const rules = rulesOf(r);
  const links = await store.read("links");
  const approved = new Map(links.filter((l) => l.status === "approved" && l.casino === rules.casino).map((l) => [l.userId, l.username]));
  const wagers = await wager.getWagers(rules.casino, Date.parse(rules.wagerFrom), Date.parse(r.endsAt), opts);
  return (r.entries || []).map((e) => {
    const name = approved.get(e.userId) || null;
    const row = name ? wagers.get(name.toLowerCase()) : null;
    const wagered = row ? round2(row.wagered) : 0;
    return Object.assign({}, e, { casinoUsername: name, wagered, tickets: name ? ticketsFor(rules, wagered) : 0 });
  });
}

/** This user's wager and tickets in each open raffle they could be in. */
async function ticketsForUser(user, raffles, links) {
  const mine = linksFor(links, user.id);
  const now = Date.now();
  const out = {};
  await Promise.all(raffles.filter((r) => raffleState(r, now) === "open").map(async (r) => {
    const rules = rulesOf(r);
    const link = mine[rules.casino];
    if (!link || link.status !== "approved") return;
    try {
      const w = round2(await wager.wagerOf(rules.casino, link.username, Date.parse(rules.wagerFrom), Date.parse(r.endsAt)));
      out[r.id] = { wagered: w, tickets: ticketsFor(rules, w) };
    } catch (err) {
      out[r.id] = { error: err.message };
    }
  }));
  return out;
}

async function touchUser(user) {
  try {
    await store.update("users", (users) => {
      const prev = users[user.id] || { createdAt: Date.now() };
      users[user.id] = Object.assign({}, prev, user, { lastSeen: Date.now() });
    });
  } catch (err) {
    console.warn("[users] couldn't save:", err.message);
  }
}

/* ---------------------------------------------------------------- public */

async function me(req, res) {
  const user = readSession(req);
  if (!user) return json(res, 200, { user: null });
  let points = null, pointsError = null;
  try { points = await botrix.getViewer(user.username); } catch (err) { pointsError = err.message; }
  return json(res, 200, { user, admin: isAdmin(user), points, pointsError });
}

async function listStore(req, res) {
  const items = (await store.read("shop")).filter((i) => !i.hidden).map(publicItem);
  return json(res, 200, { items });
}

async function listRaffles(req, res) {
  const user = readSession(req);
  const now = Date.now();
  const all = (await store.read("raffles")).map((r) => publicRaffle(r, user, now));
  return json(res, 200, {
    active: all.filter((r) => r.state === "open").sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt)),
    past: all.filter((r) => r.state !== "open").sort((a, b) => (b.drawnAt || Date.parse(b.endsAt)) - (a.drawnAt || Date.parse(a.endsAt))),
  });
}

async function redeem(req, res) {
  const user = requireUser(req);
  if (!require("../content.js").REKOJ_CONTENT.storeOpen) fail(403, "The Points Store is coming soon. Your points are safe until it opens.");
  const { itemId } = await readJson(req);
  throttle("redeem:" + user.id, 3000);

  // Reserve one from stock first, so two buyers can't take the last one
  const item = await store.update("shop", (items) => {
    const it = items.find((i) => i.id === itemId && !i.hidden);
    if (!it) fail(404, "That item isn't available any more.");
    if (it.stock !== null && it.stock !== undefined) {
      if (it.stock <= 0) fail(409, "Sold out.");
      it.stock -= 1;
    }
    return { data: items, value: Object.assign({}, it) };
  });
  const restock = () => store.update("shop", (items) => {
    const it = items.find((i) => i.id === item.id);
    if (it && it.stock !== null && it.stock !== undefined) it.stock += 1;
  }).catch(() => {});

  try {
    const viewer = await botrix.getViewer(user.username);
    if (viewer && viewer.points < item.cost) fail(400, "Not enough points: you have " + viewer.points.toLocaleString("en-US") + ".");
    await botrix.adjustPoints(user.username, -item.cost);
  } catch (err) {
    await restock();
    throw err;
  }

  const order = {
    id: store.newId(), userId: user.id, username: user.username, avatar: user.avatar || null,
    itemId: item.id, itemName: item.name, itemImage: item.image, tier: item.tier, cost: item.cost,
    status: "pending", note: "", at: Date.now(), decidedAt: null, handledBy: null, refunded: false,
  };
  try {
    await store.update("redemptions", (list) => { list.unshift(order); });
  } catch (err) {
    // Couldn't record it: give the points back rather than lose them
    await botrix.adjustPoints(user.username, item.cost).catch((e) => console.error("[store] refund failed:", e.message));
    await restock();
    throw err;
  }
  await logPoints({ by: user.username, name: user.username, delta: -item.cost, reason: "Store: " + item.name });

  let points = null;
  try { points = await botrix.getViewer(user.username); } catch (e) { /* shown on next refresh */ }
  return json(res, 200, { order, points });
}

async function myRaffles(req, res) {
  const user = requireUser(req);
  const [raffles, links] = await Promise.all([store.read("raffles"), store.read("links")]);
  const mine = linksFor(links, user.id);
  const out = {};
  CASINO_IDS.forEach((c) => { out[c] = publicLink(mine[c]); });
  return json(res, 200, { links: out, tickets: await ticketsForUser(user, raffles, links) });
}

async function joinRaffle(req, res) {
  const user = requireUser(req);
  const { id } = await readJson(req);
  throttle("join:" + user.id, 2000);
  const now = Date.now();

  const raffle = (await store.read("raffles")).find((r) => r.id === id);
  if (!raffle || raffleState(raffle, now) !== "open") fail(409, "This raffle isn't open.");
  if ((raffle.entries || []).some((e) => e.userId === user.id)) fail(409, "You're already in this raffle.");
  if ((raffle.removed || []).some((e) => e.userId === user.id)) fail(403, "You were removed from this raffle by an admin.");

  const rules = rulesOf(raffle);
  const casino = wager.CASINOS[rules.casino].name;
  const link = linksFor(await store.read("links"), user.id)[rules.casino];
  if (!link) fail(403, "Link your " + casino + " username on your profile first.");
  if (link.status === "pending") fail(403, "Your " + casino + " username is waiting for an admin to approve it.");
  if (link.status !== "approved") fail(403, "Link your " + casino + " username on your profile first.");

  await store.update("raffles", (list) => {
    const r = list.find((x) => x.id === id);
    if (!r || raffleState(r, Date.now()) !== "open") fail(409, "This raffle just closed.");
    r.entries = r.entries || [];
    if (r.entries.some((e) => e.userId === user.id)) fail(409, "You're already in this raffle.");
    r.entries.push({ userId: user.id, username: user.username, at: Date.now() });
  });
  await logRaffle(raffle, "joined", user.username, link.username + " on " + casino);

  const fresh = (await store.read("raffles")).find((r) => r.id === id);
  let mine = null;
  try {
    const w = round2(await wager.wagerOf(rules.casino, link.username, Date.parse(rules.wagerFrom), Date.parse(fresh.endsAt)));
    mine = { wagered: w, tickets: ticketsFor(rules, w) };
  } catch (err) { /* tickets show on the next refresh */ }
  return json(res, 200, { raffle: publicRaffle(fresh, user, Date.now()), mine });
}

async function activity(req, res) {
  const user = requireUser(req);
  const now = Date.now();
  const [orders, raffles, links] = await Promise.all([store.read("redemptions"), store.read("raffles"), store.read("links")]);
  const joined = raffles.filter((r) => (r.entries || []).some((e) => e.userId === user.id));
  const tickets = await ticketsForUser(user, joined, links);
  const mine = linksFor(links, user.id);
  const linkOut = {};
  CASINO_IDS.forEach((c) => { linkOut[c] = publicLink(mine[c]); });
  return json(res, 200, {
    orders: orders.filter((o) => o.userId === user.id),
    raffles: joined.map((r) => {
      const entry = (r.entries || []).find((e) => e.userId === user.id) || {};
      const won = (r.winnersList || []).find((w) => w.userId === user.id);
      return Object.assign(publicRaffle(r, user, now), {
        won: !!won,
        mine: tickets[r.id] || (r.status === "drawn" && entry.tickets !== undefined ? { wagered: entry.wagered, tickets: entry.tickets } : null),
      });
    }),
    links: linkOut,
  });
}

/**
 * Look the username up under the code. Never throws: if the casino can't be
 * reached the result says so ({ error }) and the caller decides.
 */
async function verifyUnderCode(casino, username) {
  try {
    const r = await wager.checkUnderCode(casino, username);
    return Object.assign({ at: Date.now() }, r);
  } catch (err) {
    return { at: Date.now(), error: err.message };
  }
}

/** Why a verified username can't be linked, or null if it can. */
function notUnderCodeReason(casino, username, v) {
  const name = wager.CASINOS[casino].name;
  if (v.error) return null;
  if (!v.found) {
    return casino === "razed"
      ? `We couldn't find "${username}" playing under code ${CODE} on Razed in the last ${wager.LOOK_BACK_DAYS} days. Check it matches your Razed username exactly, and that you signed up with code ${CODE}. New accounts show up after their first bet.`
      : `We couldn't find "${username}" under code ${CODE} on Razed.IO. Check it matches your Razed.IO username exactly, and that you signed up with code ${CODE}.`;
  }
  if (v.stillUnderCode === false) return `${v.name} has moved to a different code on ${name}, so it can't earn ${CODE} raffle tickets.`;
  return null;
}

/** For admins: not under the code, or couldn't be checked at all → needs "anyway". */
function adminCheckReason(casino, username, v, anyway) {
  const name = wager.CASINOS[casino].name;
  if (v.error) return `Couldn't look up ${username} on ${name} right now (${v.error}). ${anyway}`.trim();
  const r = notUnderCodeReason(casino, username, v);
  return r ? (r.replace(/^We couldn't/, "Couldn't").replace(/ Check it matches your .*$/, "") + " " + anyway).trim() : null;
}

async function requestLink(req, res) {
  const user = requireUser(req);
  const body = await readJson(req);
  const casino = cleanCasino(body.casino);
  const username = cleanCasinoName(body.username);
  throttle("link:" + user.id, 2000);
  const name = wager.CASINOS[casino].name;
  // Only usernames playing under the code can be linked. If the casino can't
  // be reached, the request still goes to an admin, marked as unchecked.
  const verified = await verifyUnderCode(casino, username);
  const reason = notUnderCodeReason(casino, username, verified);
  if (reason) fail(400, reason, "not_under_code");
  const exact = verified.found ? verified.name : username; // as the casino spells it
  await touchUser(user);
  const saved = await store.update("links", (links) => {
    const own = links.find((l) => l.userId === user.id && l.casino === casino);
    if (own && own.status === "approved") fail(409, "Your " + name + " account is already linked. Ask an admin if it needs changing.");
    if (takenBy(links, casino, exact, user.id)) fail(409, "That " + name + " username is already linked to another Kick account. Ask an admin if it's yours.");
    const next = {
      id: own ? own.id : store.newId(), userId: user.id, kickName: user.username, avatar: user.avatar || null,
      casino, username: exact, status: "pending", note: "", requestedAt: Date.now(), decidedAt: null, decidedBy: null, verified,
    };
    const rest = links.filter((l) => l !== own);
    rest.unshift(next);
    return { data: rest, value: next };
  });
  return json(res, 200, { link: publicLink(saved) });
}

async function cancelLink(req, res) {
  const user = requireUser(req);
  const casino = cleanCasino((await readJson(req)).casino);
  await store.update("links", (links) => {
    const own = links.find((l) => l.userId === user.id && l.casino === casino);
    if (!own) return;
    if (own.status === "approved") fail(409, "Approved links can only be removed by an admin.");
    return { data: links.filter((l) => l !== own) };
  });
  return json(res, 200, { ok: true });
}

/* ---------------------------------------------------------------- contact */

const TOPICS = ["general", "leaderboard", "raffles", "store", "account", "privacy"];
const contactHits = new Map();

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "";
}
// Enough to spot one sender flooding the form, without keeping their IP address
function ipTag(req) {
  return crypto.createHash("sha256").update(clientIp(req) + "|" + (process.env.SESSION_SECRET || "rekoj")).digest("hex").slice(0, 16);
}

/** Validates a contact message; throws a 400 a person can act on. Shared rules with contact.js. */
function cleanMessage(body) {
  const name = cleanText(body.name, 60);
  const reply = cleanText(body.reply, 120);
  const message = String(body.message == null ? "" : body.message).replace(/\r\n?/g, "\n").trim();
  const topic = TOPICS.includes(body.topic) ? body.topic : "general";
  if (reply.length < 2) fail(400, "Tell us how to reply: a Kick or Discord username, or an email address.");
  if (reply.includes("@") && reply.includes(".") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(reply)) fail(400, "That email address doesn't look right.");
  if (message.length < 10) fail(400, "Your message is a bit short. Tell us a little more (10 characters or more).");
  if (message.length > 2000) fail(400, "Please keep your message under 2,000 characters.");
  return { name, reply, topic, message };
}

async function forwardToDiscord(m) {
  const hook = process.env.CONTACT_DISCORD_WEBHOOK;
  if (!hook || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) return false;
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      username: "RekoJ contact form",
      allowed_mentions: { parse: [] }, // never ping @everyone from a visitor's text
      embeds: [{
        title: "New message · " + m.topic,
        description: m.message.slice(0, 4000),
        fields: [
          { name: "Reply to", value: m.reply.slice(0, 1000), inline: true },
          { name: "Name", value: (m.name || "—").slice(0, 1000), inline: true },
          { name: "Kick account", value: m.kick || "not logged in", inline: true },
        ],
        timestamp: new Date(m.at).toISOString(),
      }],
    }),
  });
  if (!res.ok) throw new Error("Discord answered " + res.status);
  return true;
}

async function contact(req, res) {
  const body = await readJson(req);
  // Spam traps: a field people can't see, and a form filled in faster than a person could
  if (body.website) fail(400, "Your message couldn't be sent. Please try again.");
  const started = Number(body.startedAt) || 0;
  if (!started || Date.now() - started < 3000) fail(400, "That was quick! Please check your message and send it again.");
  const m = cleanMessage(body);

  const tag = ipTag(req);
  const now = Date.now();
  const TOO_MANY = "You've sent a few messages already. Please wait a few minutes before sending another.";
  // Limits per sender: 3 in 10 minutes, 6 in an hour. Counted on the stored
  // messages (shared by every server instance); the in-memory count only
  // matters when there's no database and messages go to Discord alone.
  const recent = (contactHits.get(tag) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 3) fail(429, TOO_MANY);

  const user = readSession(req);
  const msg = Object.assign({ id: store.newId(), at: now, status: "new", kick: user ? user.username : null, ipTag: tag }, m);

  let stored = false, forwarded = false, storeErr = null;
  try {
    await store.update("messages", (list) => {
      const mine = list.filter((x) => x.ipTag === tag);
      if (mine.filter((x) => now - x.at < 10 * 60 * 1000).length >= 3 || mine.filter((x) => now - x.at < 60 * 60 * 1000).length >= 6) fail(429, TOO_MANY);
      list.unshift(msg);
      if (list.length > 2000) list.length = 2000;
    });
    stored = true;
  } catch (err) {
    if (err.status === 429) throw err;
    storeErr = err;
  }
  try { forwarded = await forwardToDiscord(msg); } catch (err) { console.error("[contact] Discord forward failed:", err.message); }

  if (!stored && !forwarded) {
    console.error("[contact] message not delivered:", storeErr && storeErr.message);
    fail(503, "Sorry, your message couldn't be delivered right now. Please try again later, or message us on Discord or X.");
  }
  recent.push(now);
  contactHits.set(tag, recent);
  return json(res, 200, { ok: true });
}

/* ---------------------------------------------------------------- overlays */

async function overlayRaffle(req, res, url) {
  const id = url.searchParams.get("id");
  const now = Date.now();
  const list = await store.read("raffles");
  let r = id ? list.find((x) => x.id === id) : null;
  if (!r) {
    const open = list.filter((x) => raffleState(x, now) === "open").sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
    const drawn = list.filter((x) => x.status === "drawn").sort((a, b) => (b.drawnAt || 0) - (a.drawnAt || 0));
    // A draw from the last 10 minutes takes the stage; otherwise the next one to end
    r = drawn[0] && now - (drawn[0].drawnAt || 0) < 10 * 60 * 1000 ? drawn[0] : open[0] || drawn[0] || null;
  }
  return json(res, 200, { raffle: r ? publicRaffle(r, null, now) : null });
}

async function overlayAlerts(req, res) {
  const recent = (await store.read("redemptions")).slice(0, 15).map((o) => ({
    id: o.id, username: o.username, avatar: o.avatar, itemName: o.itemName, itemImage: o.itemImage, tier: o.tier, cost: o.cost, at: o.at,
  }));
  return json(res, 200, { alerts: recent });
}

/* ---------------------------------------------------------------- admin */

async function adminOverview(req, res) {
  requireAdmin(req);
  const [users, orders, raffles, shop, links, raffleLog, messages] = await Promise.all([
    store.read("users"), store.read("redemptions"), store.read("raffles"), store.read("shop"), store.read("links"), store.read("raffleLog"), store.read("messages"),
  ]);
  const now = Date.now();
  return json(res, 200, {
    counts: {
      users: Object.keys(users).length,
      pending: orders.filter((o) => o.status === "pending").length,
      linkRequests: links.filter((l) => l.status === "pending").length,
      orders: orders.length,
      openRaffles: raffles.filter((r) => raffleState(r, now) === "open").length,
      readyToDraw: raffles.filter((r) => raffleState(r, now) === "ended" && (r.entries || []).length).length,
      newMessages: messages.filter((m) => m.status === "new").length,
      items: shop.filter((i) => !i.hidden).length,
    },
    setup: {
      storage: store.storageKind(),
      kick: !!(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET),
      botrix: !!process.env.BOTRIX_BID,
      channel: botrix.CHANNEL(),
      razed: wager.configured("razed"),
      razedio: wager.configured("razedio"),
      contactRelay: !!process.env.CONTACT_DISCORD_WEBHOOK,
      storeOpen: !!require("../content.js").REKOJ_CONTENT.storeOpen,
      admins: String(process.env.ADMIN_KICK_USERNAMES || "rekoj,aspect900"),
    },
    recentOrders: orders.slice(0, 6),
    raffleActivity: raffleLog.slice(0, 8),
  });
}

async function adminStoreList(req, res) {
  requireAdmin(req);
  return json(res, 200, { items: await store.read("shop") });
}

function cleanItem(input, existing) {
  const name = cleanText(input.name, 60);
  if (!name) fail(400, "Give the item a name.");
  const cost = cleanInt(input.cost, 1, 100000000);
  if (cost === null) fail(400, "Price must be a whole number of points.");
  const tier = TIERS.includes(input.tier) ? input.tier : "blue";
  const image = cleanText(input.image, 500);
  if (!["xbox", "af1", "keyboard", "bonusbuy"].includes(image) && !isUrl(image)) fail(400, "Pick a picture, upload one, or paste an https:// image link.");
  let stock = null;
  if (input.stock !== null && input.stock !== "" && input.stock !== undefined) {
    stock = cleanInt(input.stock, 0, 1000000);
    if (stock === null) fail(400, "Stock must be a whole number (or empty for unlimited).");
  }
  return Object.assign({}, existing || { id: store.newId(), createdAt: Date.now() }, { name, cost, tier, image, stock, hidden: !!input.hidden });
}

async function adminStoreSave(req, res) {
  requireAdmin(req);
  const { item } = await readJson(req);
  const saved = await store.update("shop", (items) => {
    const i = item && item.id ? items.findIndex((x) => x.id === item.id) : -1;
    const next = cleanItem(item || {}, i >= 0 ? items[i] : null);
    if (i >= 0) items[i] = next; else items.push(next);
    return { data: items, value: next };
  });
  return json(res, 200, { item: saved });
}

async function adminStoreDelete(req, res) {
  requireAdmin(req);
  const { id } = await readJson(req);
  await store.update("shop", (items) => ({ data: items.filter((i) => i.id !== id) }));
  return json(res, 200, { ok: true });
}

async function adminOrders(req, res) {
  requireAdmin(req);
  return json(res, 200, { orders: await store.read("redemptions") });
}

async function adminOrderDecide(req, res) {
  const admin = requireAdmin(req);
  const { id, action, note } = await readJson(req);
  if (!["fulfil", "reject"].includes(action)) fail(400, "Unknown action.");
  const order = (await store.read("redemptions")).find((o) => o.id === id);
  if (!order) fail(404, "Order not found.");
  if (order.status !== "pending") fail(409, "That order was already handled.");

  // Rejecting gives the points back first; if BotRix refuses, nothing changes
  if (action === "reject") {
    await botrix.adjustPoints(order.username, order.cost);
    await logPoints({ by: admin.username, name: order.username, delta: order.cost, reason: "Refund: " + order.itemName });
    await store.update("shop", (items) => {
      const it = items.find((i) => i.id === order.itemId);
      if (it && it.stock !== null && it.stock !== undefined) it.stock += 1;
    }).catch(() => {});
  }
  const saved = await store.update("redemptions", (list) => {
    const o = list.find((x) => x.id === id);
    if (!o || o.status !== "pending") fail(409, "That order was already handled.");
    o.status = action === "fulfil" ? "fulfilled" : "rejected";
    o.note = cleanText(note, 200);
    o.decidedAt = Date.now();
    o.handledBy = admin.username;
    o.refunded = action === "reject";
    return { data: list, value: Object.assign({}, o) };
  });
  return json(res, 200, { order: saved });
}

function cleanRaffle(input, existing) {
  const game = cleanText(input.game, 60);
  const prize = cleanText(input.prize, 60); // optional subtitle
  if (!game) fail(400, "Give the raffle a title.");
  const value = cleanInt(input.value, 0, 10000000);
  const winners = cleanInt(input.winners, 1, 100);
  if (value === null) fail(400, "Prize value must be a whole number of dollars.");
  if (winners === null) fail(400, "Winners must be between 1 and 100.");
  const endsAt = new Date(input.endsAt);
  if (isNaN(endsAt.getTime())) fail(400, "Pick when the raffle ends.");
  const wagerFrom = new Date(input.wagerFrom);
  if (isNaN(wagerFrom.getTime())) fail(400, "Pick when wagering starts to count.");
  const thumb = cleanText(input.thumb, 500);
  if (!["wanted", "gates", "sweet-bonanza"].includes(thumb) && !isUrl(thumb)) fail(400, "Pick a thumbnail, upload one, or paste an https:// image link.");

  const casino = cleanCasino(input.casino);
  const perDollars = cleanNum(input.perDollars, 0.01, 10000000);
  const ticketsPer = cleanInt(input.ticketsPer, 1, 1000000);
  const minWager = cleanNum(input.minWager === "" || input.minWager == null ? 0 : input.minWager, 0, 100000000);
  const maxTickets = cleanInt(input.maxTickets === "" || input.maxTickets == null ? 0 : input.maxTickets, 0, 100000000);
  if (perDollars === null) fail(400, "Enter how many dollars wagered earn tickets (more than 0).");
  if (ticketsPer === null) fail(400, "Tickets per step must be a whole number, 1 or more.");
  if (minWager === null) fail(400, "Minimum wager must be 0 or more.");
  if (maxTickets === null) fail(400, "Max tickets must be a whole number (0 for no cap).");
  try {
    wager.checkWindow(casino, wagerFrom.getTime(), endsAt.getTime());
  } catch (err) {
    fail(400, err.message);
  }

  return Object.assign({}, existing || {
    id: store.newId(), status: "open", entries: [], winnersList: [], seedEntries: 0, createdAt: Date.now(), drawnAt: null,
  }, {
    game, prize, value, winners, endsAt: endsAt.toISOString(), thumb, placeholder: false,
    casino, wagerFrom: wagerFrom.toISOString(), perDollars, ticketsPer, minWager, maxTickets,
  });
}

async function adminRaffles(req, res) {
  requireAdmin(req);
  const now = Date.now();
  const list = (await store.read("raffles")).map((r) => Object.assign({}, r, rulesOf(r), { state: raffleState(r, now) }));
  return json(res, 200, { raffles: list });
}

/** Entries, ticket holders, tickets and wager for a raffle: saved numbers once drawn, live before. */
function summarise(entries) {
  const top = entries.filter((e) => e.tickets > 0).sort((a, b) => b.tickets - a.tickets)[0] || null;
  return {
    entries: entries.length,
    eligible: entries.filter((e) => e.tickets > 0).length,
    tickets: entries.reduce((s, e) => s + (e.tickets || 0), 0),
    wagered: round2(entries.reduce((s, e) => s + (e.wagered || 0), 0)),
    top: top ? { username: top.username, tickets: top.tickets } : null,
  };
}
function drawnSnapshot(r) {
  return r.status === "drawn" && (r.entries || []).every((e) => e.tickets !== undefined);
}

async function adminRaffleStats(req, res) {
  requireAdmin(req);
  const out = {};
  await Promise.all((await store.read("raffles")).map(async (r) => {
    if (drawnSnapshot(r)) { out[r.id] = Object.assign(summarise(r.entries || []), { snapshot: true }); return; }
    if (r.status === "drawn") { out[r.id] = { entries: (r.entries || []).length + (r.seedEntries || 0), snapshot: true }; return; }
    try {
      out[r.id] = summarise(await entriesWithTickets(r));
    } catch (err) {
      out[r.id] = { entries: (r.entries || []).length, error: err.message };
    }
  }));
  return json(res, 200, { stats: out, at: Date.now() });
}

async function adminRaffleDetail(req, res, url) {
  requireAdmin(req);
  const id = url.searchParams.get("id");
  const [raffles, log] = await Promise.all([store.read("raffles"), store.read("raffleLog")]);
  const r = raffles.find((x) => x.id === id);
  if (!r) fail(404, "That raffle doesn't exist any more.");
  let entries, error = null, snapshot = drawnSnapshot(r);
  if (snapshot) entries = r.entries || [];
  else {
    try { entries = await entriesWithTickets(r); } catch (err) {
      error = err.message;
      entries = (r.entries || []).map((e) => Object.assign({}, e, { tickets: null, wagered: null }));
    }
  }
  return json(res, 200, {
    raffle: Object.assign({}, r, rulesOf(r), { state: raffleState(r, Date.now()), entries: undefined }),
    entries, summary: summarise(entries), snapshot, error,
    removed: r.removed || [],
    draws: r.draws || [],
    log: log.filter((l) => l.raffleId === id).slice(0, 200),
    at: Date.now(),
  });
}

async function adminRaffleLog(req, res) {
  requireAdmin(req);
  return json(res, 200, { log: (await store.read("raffleLog")).slice(0, 300) });
}

async function adminRaffleEnd(req, res) {
  const admin = requireAdmin(req);
  const { id } = await readJson(req);
  const saved = await store.update("raffles", (list) => {
    const r = list.find((x) => x.id === id);
    if (!r) fail(404, "Raffle not found.");
    if (raffleState(r, Date.now()) !== "open") fail(409, "That raffle has already ended.");
    if (Date.parse(rulesOf(r).wagerFrom) >= Date.now()) fail(409, "Its wager window hasn't started yet, so there's nothing to draw. Delete it or move the dates instead.");
    r.endsAt = new Date().toISOString();
    r.placeholder = false;
    return { data: list, value: Object.assign({}, r) };
  });
  await logRaffle(saved, "ended", admin.username, "Ended early");
  return json(res, 200, { raffle: saved });
}

async function adminRaffleDuplicate(req, res) {
  const admin = requireAdmin(req);
  const { id } = await readJson(req);
  const saved = await store.update("raffles", (list) => {
    const r = list.find((x) => x.id === id);
    if (!r) fail(404, "Raffle not found.");
    const rules = rulesOf(r);
    const span = Math.max(DAY, Date.parse(r.endsAt) - Date.parse(rules.wagerFrom));
    const now = Date.now();
    const copy = Object.assign({}, rules, {
      id: store.newId(), game: r.game, prize: r.prize, value: r.value, winners: r.winners, thumb: r.thumb,
      wagerFrom: new Date(now).toISOString(), endsAt: new Date(now + Math.min(span, 44 * DAY)).toISOString(),
      status: "open", entries: [], winnersList: [], seedEntries: 0, placeholder: false, createdAt: now, drawnAt: null,
    });
    list.push(copy);
    return { data: list, value: copy };
  });
  await logRaffle(saved, "created", admin.username, "Copied from an earlier raffle");
  return json(res, 200, { raffle: saved });
}

async function adminRaffleRemoveEntry(req, res) {
  const admin = requireAdmin(req);
  const { id, userId, reason } = await readJson(req);
  let removed = null;
  const saved = await store.update("raffles", (list) => {
    const r = list.find((x) => x.id === id);
    if (!r) fail(404, "Raffle not found.");
    if (r.status === "drawn") fail(409, "This raffle has been drawn. Redraw after removing isn't possible; delete and recreate it instead.");
    const e = (r.entries || []).find((x) => x.userId === userId);
    if (!e) fail(404, "That player isn't in this raffle.");
    r.entries = r.entries.filter((x) => x !== e);
    removed = { userId: e.userId, username: e.username, reason: cleanText(reason, 200), at: Date.now(), by: admin.username };
    r.removed = (r.removed || []).filter((x) => x.userId !== userId).concat([removed]);
    return { data: list, value: Object.assign({}, r) };
  });
  await logRaffle(saved, "removed", admin.username, removed.username + (removed.reason ? ": " + removed.reason : ""));
  return json(res, 200, { ok: true });
}

async function adminRaffleReinstate(req, res) {
  const admin = requireAdmin(req);
  const { id, userId } = await readJson(req);
  let who = null;
  const saved = await store.update("raffles", (list) => {
    const r = list.find((x) => x.id === id);
    if (!r) fail(404, "Raffle not found.");
    who = (r.removed || []).find((x) => x.userId === userId);
    if (!who) fail(404, "That player wasn't removed.");
    r.removed = r.removed.filter((x) => x !== who);
    return { data: list, value: Object.assign({}, r) };
  });
  await logRaffle(saved, "reinstated", admin.username, who.username + " may join again");
  return json(res, 200, { ok: true });
}

async function adminRaffleEntries(req, res, url) {
  requireAdmin(req);
  const r = (await store.read("raffles")).find((x) => x.id === url.searchParams.get("id"));
  if (!r) fail(404, "Raffle not found.");
  // A drawn raffle shows the numbers it was drawn with
  if (r.status === "drawn" && (r.entries || []).every((e) => e.tickets !== undefined)) {
    return json(res, 200, { entries: r.entries, totalTickets: r.totalTickets || 0, snapshot: true, drawnAt: r.drawnAt });
  }
  let entries, error = null;
  try {
    entries = await entriesWithTickets(r);
  } catch (err) {
    error = err.message;
    entries = (r.entries || []).map((e) => Object.assign({}, e, { tickets: null, wagered: null }));
  }
  return json(res, 200, { entries, totalTickets: entries.reduce((s, e) => s + (e.tickets || 0), 0), snapshot: false, error });
}

async function adminRaffleSave(req, res) {
  const admin = requireAdmin(req);
  const { raffle } = await readJson(req);
  let isNew = true;
  const saved = await store.update("raffles", (list) => {
    const i = raffle && raffle.id ? list.findIndex((x) => x.id === raffle.id) : -1;
    isNew = i < 0;
    const next = cleanRaffle(raffle || {}, i >= 0 ? list[i] : null);
    // Moving the end date into the future reopens an ended (undrawn) raffle
    if (i >= 0) list[i] = next; else list.push(next);
    return { data: list, value: next };
  });
  await logRaffle(saved, isNew ? "created" : "edited", admin.username, ruleSummary(saved));
  return json(res, 200, { raffle: saved });
}

function ruleSummary(r) {
  const x = rulesOf(r);
  return wager.CASINOS[x.casino].name + ", $" + x.perDollars + " = " + x.ticketsPer + " ticket" + (x.ticketsPer === 1 ? "" : "s") +
    (x.minWager ? ", min $" + x.minWager : "") + (x.maxTickets ? ", max " + x.maxTickets : "") + ", ends " + new Date(r.endsAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

async function adminRaffleDelete(req, res) {
  const admin = requireAdmin(req);
  const { id } = await readJson(req);
  let gone = null;
  await store.update("raffles", (list) => {
    gone = list.find((r) => r.id === id) || null;
    return { data: list.filter((r) => r.id !== id) };
  });
  if (gone) await logRaffle(gone, "deleted", admin.username, (gone.entries || []).length + " entries");
  return json(res, 200, { ok: true });
}

/** Pick `count` entries without repeats, each weighted by its tickets. */
function weightedPicks(pool, count) {
  const left = pool.slice();
  const picks = [];
  while (picks.length < count && left.length) {
    const total = left.reduce((s, e) => s + e.tickets, 0);
    let ticket = crypto.randomInt(total); // fair, unpredictable
    let i = 0;
    while (ticket >= left[i].tickets) { ticket -= left[i].tickets; i++; }
    picks.push(left.splice(i, 1)[0]);
  }
  return picks;
}

async function adminRaffleDraw(req, res) {
  const admin = requireAdmin(req);
  const { id } = await readJson(req);
  const raffle = (await store.read("raffles")).find((x) => x.id === id);
  if (!raffle) fail(404, "Raffle not found.");
  if (!(raffle.entries || []).length) fail(409, "Nobody has entered yet.");
  throttle("draw:" + id, 3000);

  // Fresh numbers from the casino: never draw on a cached or stale answer
  let entries;
  try {
    entries = await entriesWithTickets(raffle, { fresh: true });
  } catch (err) {
    fail(err.status && err.status < 500 ? err.status : 502, "Couldn't get wagers to draw with: " + err.message);
  }
  const pool = entries.filter((e) => e.tickets > 0);
  if (!pool.length) fail(409, "None of the " + entries.length + " entrants has a ticket yet: nobody with an approved link has wagered enough in the window.");
  const picks = weightedPicks(pool, raffle.winners);
  const totalTickets = pool.reduce((s, e) => s + e.tickets, 0);

  const saved = await store.update("raffles", (list) => {
    const r = list.find((x) => x.id === id);
    if (!r) fail(404, "Raffle not found.");
    const byUser = new Map(entries.map((e) => [e.userId, e]));
    // Keep the numbers it was drawn with, for anyone who asks later
    r.entries = (r.entries || []).map((e) => {
      const s = byUser.get(e.userId);
      return Object.assign({}, e, s ? { casinoUsername: s.casinoUsername, wagered: s.wagered, tickets: s.tickets } : { tickets: 0, wagered: 0 });
    });
    const redraw = r.status === "drawn";
    r.winnersList = picks.map((w) => ({ userId: w.userId, username: w.username, casinoUsername: w.casinoUsername, tickets: w.tickets, wagered: w.wagered }));
    r.totalTickets = totalTickets;
    r.status = "drawn";
    r.drawnAt = Date.now();
    r.drawnBy = admin.username;
    // Every draw is kept, so a redraw never hides who won before
    r.draws = (r.draws || []).concat([{
      at: r.drawnAt, by: admin.username, redraw, totalTickets, eligible: pool.length, entries: entries.length,
      winners: r.winnersList.map((w) => ({ username: w.username, casinoUsername: w.casinoUsername, tickets: w.tickets })),
    }]);
    return { data: list, value: Object.assign({}, r) };
  });
  await logRaffle(saved, saved.draws.length > 1 ? "redrawn" : "drawn", admin.username,
    saved.winnersList.map((w) => w.username + " (" + w.tickets + ")").join(", ") + " · " + totalTickets + " tickets");
  return json(res, 200, { raffle: saved });
}

async function adminLinks(req, res) {
  requireAdmin(req);
  const links = await store.read("links");
  // Each username's wager under the code over the last 30 days, to check before approving
  const to = Math.floor(Date.now() / 60000) * 60000;
  const from = to - 30 * DAY;
  const wagers = {}, errors = {};
  await Promise.all(CASINO_IDS.map(async (c) => {
    if (!links.some((l) => l.casino === c)) return;
    try { wagers[c] = await wager.getWagers(c, from, to); } catch (err) { errors[c] = err.message; }
  }));
  const order = { pending: 0, approved: 1, rejected: 2, unlinked: 3 };
  const list = links
    .map((l) => {
      const map = wagers[l.casino];
      const row = map ? map.get(l.username.toLowerCase()) : null;
      return Object.assign({}, l, { casinoName: wager.CASINOS[l.casino].name, wager30: map ? (row ? round2(row.wagered) : 0) : null });
    })
    .sort((a, b) => order[a.status] - order[b.status] || b.requestedAt - a.requestedAt);
  return json(res, 200, { links: list, errors });
}

async function adminLinkDecide(req, res) {
  const admin = requireAdmin(req);
  const { id, action, note, force } = await readJson(req);
  if (!["approve", "reject", "unlink"].includes(action)) fail(400, "Unknown action.");
  let verified = null;
  if (action === "approve") {
    const l = (await store.read("links")).find((x) => x.id === id);
    if (!l) fail(404, "That link is gone.");
    verified = await verifyUnderCode(l.casino, l.username);
    const reason = adminCheckReason(l.casino, l.username, verified, "Approve it anyway only if you're sure it's theirs.");
    if (reason && !force) fail(409, reason, "not_under_code");
  }
  const saved = await store.update("links", (links) => {
    const l = links.find((x) => x.id === id);
    if (!l) fail(404, "That link is gone.");
    if (action === "approve") {
      if (l.status !== "pending") fail(409, "Only waiting requests can be approved.");
      const other = takenBy(links, l.casino, l.username, l.userId);
      if (other && other.status === "approved") fail(409, l.username + " is already linked to " + other.kickName + ". Unlink that one first.");
      l.status = "approved";
      l.verified = verified;
      if (verified && verified.found && verified.name) l.username = verified.name;
      if (force && adminCheckReason(l.casino, l.username, verified, "")) l.approvedAnyway = true;
    } else if (action === "reject") {
      if (l.status !== "pending") fail(409, "Only waiting requests can be rejected.");
      l.status = "rejected";
    } else {
      if (l.status !== "approved" && l.status !== "pending") fail(409, "That account isn't linked.");
      l.status = "unlinked";
    }
    l.note = cleanText(note, 200);
    l.decidedAt = Date.now();
    l.decidedBy = admin.username;
    return { data: links, value: Object.assign({}, l) };
  });
  return json(res, 200, { link: saved });
}

async function adminLinkCheck(req, res) {
  requireAdmin(req);
  const { id } = await readJson(req);
  const l = (await store.read("links")).find((x) => x.id === id);
  if (!l) fail(404, "That link is gone.");
  const verified = await verifyUnderCode(l.casino, l.username);
  await store.update("links", (links) => { const x = links.find((y) => y.id === id); if (x) x.verified = verified; });
  return json(res, 200, { verified });
}

async function adminLinkManual(req, res) {
  const admin = requireAdmin(req);
  const body = await readJson(req);
  const casino = cleanCasino(body.casino);
  const username = cleanCasinoName(body.username);
  const kickName = cleanText(body.kick, 40).toLowerCase();
  const users = await store.read("users");
  const user = Object.values(users).find((u) => String(u.username || "").toLowerCase() === kickName);
  if (!user) fail(404, "No one called " + (body.kick || "that") + " has logged in on the site yet. They need to log in with Kick once first.");
  const verified = await verifyUnderCode(casino, username);
  const reason = adminCheckReason(casino, username, verified, "Link it anyway only if you're sure.");
  if (reason && !body.force) fail(409, reason, "not_under_code");
  const exact = verified.found ? verified.name : username;
  const saved = await store.update("links", (links) => {
    if (takenBy(links, casino, exact, user.id)) fail(409, exact + " is already linked to (or requested by) another Kick account.");
    const own = links.find((l) => l.userId === user.id && l.casino === casino);
    const next = {
      id: own ? own.id : store.newId(), userId: user.id, kickName: user.username, avatar: user.avatar || null,
      casino, username: exact, status: "approved", note: "Linked by an admin", requestedAt: Date.now(), decidedAt: Date.now(), decidedBy: admin.username,
      verified, approvedAnyway: !!reason,
    };
    return { data: [next].concat(links.filter((l) => l !== own)), value: next };
  });
  return json(res, 200, { link: saved });
}

async function adminMessages(req, res) {
  requireAdmin(req);
  const list = (await store.read("messages")).map((m) => Object.assign({}, m, { ipTag: undefined }));
  return json(res, 200, { messages: list });
}

async function adminMessageAction(req, res) {
  const admin = requireAdmin(req);
  const { id, action } = await readJson(req);
  if (!["done", "reopen", "delete"].includes(action)) fail(400, "Unknown action.");
  await store.update("messages", (list) => {
    const m = list.find((x) => x.id === id);
    if (!m) fail(404, "That message is gone.");
    if (action === "delete") return { data: list.filter((x) => x !== m) };
    m.status = action === "done" ? "done" : "new";
    m.handledBy = action === "done" ? admin.username : null;
    m.handledAt = action === "done" ? Date.now() : null;
  });
  return json(res, 200, { ok: true });
}

/* ---------------------------------------------------------------- images */

const IMAGE_TYPES = {
  "image/webp": (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  "image/png": (b) => b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG",
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.length > 6 && b.toString("ascii", 0, 3) === "GIF",
};
const MAX_IMAGE_BYTES = 180 * 1024;

/** Admin upload: { data: "data:image/webp;base64,…" } → { url: "/api/image/<id>" } */
async function adminImageUpload(req, res) {
  requireAdmin(req);
  const { data } = await readJson(req);
  const m = /^data:(image\/(?:webp|png|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
  if (!m) fail(400, "Upload a PNG, JPEG, WebP or GIF image.");
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) fail(400, "That image is empty.");
  if (buf.length > MAX_IMAGE_BYTES) fail(413, "That image is too big even after shrinking. Try a smaller one.");
  // The bytes must really be the type they claim (no SVG or HTML sneaking in)
  if (!IMAGE_TYPES[m[1]](buf)) fail(400, "That file isn't a valid " + m[1].slice(6).toUpperCase() + " image.");
  const id = store.newId();
  await store.putImage(id, m[1], buf);
  return json(res, 200, { url: "/api/image/" + id });
}

async function serveImage(req, res, id) {
  const img = await store.getImage(id);
  if (!img) return json(res, 404, { error: "Image not found." });
  res.statusCode = 200;
  res.setHeader("Content-Type", img.mime);
  res.setHeader("Content-Length", img.buf.length);
  // Ids are random and an image never changes, so it can be cached for good
  res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  return res.end(img.buf);
}

async function adminUsers(req, res) {
  requireAdmin(req);
  const [users, orders, links] = await Promise.all([store.read("users"), store.read("redemptions"), store.read("links")]);
  const list = Object.values(users)
    .map((u) => Object.assign({}, u, {
      orders: orders.filter((o) => o.userId === u.id).length,
      links: links.filter((l) => l.userId === u.id && l.status === "approved").map((l) => ({ casino: l.casino, username: l.username })),
    }))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return json(res, 200, { users: list });
}

async function adminPointsLookup(req, res, url) {
  requireAdmin(req);
  const name = cleanText(url.searchParams.get("name"), 40);
  const viewer = name ? await botrix.getViewer(name) : null;
  const log = (await store.read("pointsLog")).slice(0, 60);
  return json(res, 200, { viewer, log });
}

async function adminPointsAdjust(req, res) {
  const admin = requireAdmin(req);
  const body = await readJson(req);
  const name = cleanText(body.name, 40);
  const delta = cleanInt(body.delta, -100000000, 100000000);
  if (!name) fail(400, "Enter a Kick username.");
  if (!delta) fail(400, "Enter how many points to add or take.");
  await botrix.adjustPoints(name, delta);
  await logPoints({ by: admin.username, name, delta, reason: cleanText(body.reason, 120) || "Admin adjustment" });
  return json(res, 200, { viewer: await botrix.getViewer(name).catch(() => null) });
}

/* ---------------------------------------------------------------- routing */

const ROUTES = {
  "GET /api/auth/kick/login": (req, res, url) => kick.login(req, res, url),
  "GET /api/auth/kick/callback": (req, res, url) => kick.callback(req, res, url),
  "POST /api/auth/logout": kick.logout,
  "GET /api/me": me,
  "GET /api/me/activity": activity,
  "POST /api/me/links": requestLink,
  "POST /api/me/links/cancel": cancelLink,
  "GET /api/store": listStore,
  "POST /api/store/redeem": redeem,
  "GET /api/raffles": listRaffles,
  "GET /api/raffles/mine": myRaffles,
  "POST /api/raffles/join": joinRaffle,
  "GET /api/overlay/raffle": overlayRaffle,
  "GET /api/overlay/alerts": overlayAlerts,
  "POST /api/contact": contact,
  "GET /api/admin/messages": adminMessages,
  "POST /api/admin/messages": adminMessageAction,
  "GET /api/admin/overview": adminOverview,
  "GET /api/admin/store": adminStoreList,
  "POST /api/admin/store": adminStoreSave,
  "POST /api/admin/store/delete": adminStoreDelete,
  "GET /api/admin/redemptions": adminOrders,
  "POST /api/admin/redemptions": adminOrderDecide,
  "GET /api/admin/raffles": adminRaffles,
  "GET /api/admin/raffles/entries": adminRaffleEntries,
  "GET /api/admin/raffles/stats": adminRaffleStats,
  "GET /api/admin/raffles/detail": adminRaffleDetail,
  "GET /api/admin/raffles/log": adminRaffleLog,
  "POST /api/admin/raffles/end": adminRaffleEnd,
  "POST /api/admin/raffles/duplicate": adminRaffleDuplicate,
  "POST /api/admin/raffles/remove-entry": adminRaffleRemoveEntry,
  "POST /api/admin/raffles/reinstate": adminRaffleReinstate,
  "POST /api/admin/raffles": adminRaffleSave,
  "POST /api/admin/raffles/delete": adminRaffleDelete,
  "POST /api/admin/raffles/draw": adminRaffleDraw,
  "GET /api/admin/links": adminLinks,
  "POST /api/admin/links": adminLinkDecide,
  "POST /api/admin/links/manual": adminLinkManual,
  "POST /api/admin/links/check": adminLinkCheck,
  "POST /api/admin/images": adminImageUpload,
  "GET /api/admin/users": adminUsers,
  "GET /api/admin/points": adminPointsLookup,
  "POST /api/admin/points": adminPointsAdjust,
};

module.exports = serveApi;
// For tests
module.exports._test = { ticketsFor, rulesOf, weightedPicks, cleanMessage };

async function serveApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "");
  const image = req.method === "GET" && /^\/api\/image\/([0-9a-f-]{36})$/.exec(path);
  const handler = image ? (rq, rs) => serveImage(rq, rs, image[1]) : ROUTES[req.method + " " + path];
  if (!handler) return json(res, 404, { error: "Not found." });
  if (req.method === "POST" && !sameOrigin(req)) return json(res, 403, { error: "Cross-site request refused." });
  try {
    await handler(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("[api]", req.method, path, err);
    if (!res.headersSent) json(res, status, Object.assign(
      { error: status >= 500 && !err.status ? "Something went wrong. Please try again." : err.message },
      err instanceof HttpError && err.code ? { code: err.code } : {}));
  }
}
