/*
 * Where accounts, store items, orders, raffles and the points log live.
 *
 * With DATABASE_URL (Neon Postgres, e.g. added from Vercel → Storage), each
 * table is one jsonb row in rekoj_store, read fresh on every call because
 * Vercel runs many instances. Writes are optimistic: a row carries a version
 * and update() retries if another instance saved in between.
 *
 * Without it, tables are JSON files in .data/ (gitignored), written
 * atomically. That's for local development: Vercel has no writable disk, so
 * there writes answer 503 until DATABASE_URL is set.
 */
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", ".data");
const TABLE = "rekoj_store";

class StoreUnavailable extends Error {
  constructor() {
    super("Storage isn't set up yet: add DATABASE_URL (Neon) in Vercel → Settings → Environment Variables.");
    this.status = 503;
  }
}

/* ---------------------------------------------------------------- defaults */

function newId() { return crypto.randomUUID(); }

// First run: start from the items and raffles in content.js (the design's).
function defaults(table) {
  const C = require("../content.js").REKOJ_CONTENT;
  const now = Date.now();
  switch (table) {
    case "users": return {};
    case "redemptions": return [];
    case "pointsLog": return [];
    case "links": return [];
    case "raffleLog": return [];
    case "messages": return [];
    case "earnings": return {};
    case "shop":
      return C.store.map((item, i) => ({
        id: newId(), name: item.name, cost: item.cost, tier: item.tier, image: item.image,
        stock: null, hidden: false, createdAt: now + i,
      }));
    case "raffles": {
      // Wager raffles: every $100 wagered on Razed from today gives a ticket
      const rules = { casino: "razed", wagerFrom: new Date(now).toISOString(), perDollars: 100, ticketsPer: 1, minWager: 0, maxTickets: 0 };
      const active = C.raffles.active.map((r, i) => Object.assign({
        id: newId(), game: r.game, prize: r.prize, value: r.value, winners: r.winners, thumb: r.thumb,
        endsAt: r.endsAt, status: "open", entries: [], winnersList: [],
        seedEntries: 0, placeholder: true, createdAt: now + i, drawnAt: null,
      }, rules));
      const past = C.raffles.past.map((r, i) => ({
        id: newId(), game: r.game, prize: r.prize, value: r.value, winners: r.winners, thumb: r.thumb,
        endsAt: r.endedAt, status: "drawn", entries: [], winnersList: [],
        seedEntries: r.entries, placeholder: true, createdAt: now - 1000 + i, drawnAt: Date.parse(r.endedAt) || now,
      }));
      return active.concat(past);
    }
    default: throw new Error("Unknown table " + table);
  }
}

/* ---------------------------------------------------------------- Postgres (Neon) */

let sqlClient = null;
let ready = null;
function sql() {
  if (!sqlClient) {
    const { neon } = require("@neondatabase/serverless");
    sqlClient = neon(dbUrl());
  }
  return sqlClient;
}
function ensureTable() {
  if (!ready) {
    ready = sql()`CREATE TABLE IF NOT EXISTS rekoj_store (
      name text PRIMARY KEY, data jsonb NOT NULL, version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
    )`.catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function pgRead(table) {
  await ensureTable();
  const rows = await sql()`SELECT data, version FROM rekoj_store WHERE name = ${table}`;
  if (rows.length) return { data: rows[0].data, version: rows[0].version };
  const data = defaults(table);
  await sql()`INSERT INTO rekoj_store (name, data, version) VALUES (${table}, ${JSON.stringify(data)}::jsonb, 0) ON CONFLICT (name) DO NOTHING`;
  const again = await sql()`SELECT data, version FROM rekoj_store WHERE name = ${table}`;
  return { data: again[0].data, version: again[0].version };
}

async function pgUpdate(table, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, version } = await pgRead(table);
    const result = await fn(data);
    const next = result && result.data !== undefined ? result.data : data;
    const saved = await sql()`UPDATE rekoj_store SET data = ${JSON.stringify(next)}::jsonb, version = version + 1, updated_at = now()
      WHERE name = ${table} AND version = ${version} RETURNING version`;
    if (saved.length) return result && result.value !== undefined ? result.value : next;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 80)); // someone else saved: try again
  }
  throw Object.assign(new Error("Busy saving; please try again."), { status: 503 });
}

/* ---------------------------------------------------------------- files (local) */

const queues = {};
function fileOf(table) { return path.join(DATA_DIR, table + ".json"); }

/** Read a table, saving the defaults on first use. Only call from inside the table's queue. */
async function readOrSeed(table) {
  try {
    return JSON.parse(await fsp.readFile(fileOf(table), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    // First read: save the defaults so their ids stay the same from now on
    const data = defaults(table);
    if (!process.env.VERCEL) await fileWrite(table, data);
    return data;
  }
}

async function fileRead(table) {
  try {
    return JSON.parse(await fsp.readFile(fileOf(table), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    // Seed through the table's queue, so simultaneous first reads seed it once
    const run = (queues[table] || Promise.resolve()).then(() => readOrSeed(table));
    queues[table] = run.catch(() => {});
    return run;
  }
}

async function fileWrite(table, data) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = fileOf(table) + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, fileOf(table));
}

function fileUpdate(table, fn) {
  // One write at a time per table within this process
  const run = (queues[table] || Promise.resolve()).then(async () => {
    const data = await readOrSeed(table);
    const result = await fn(data);
    const next = result && result.data !== undefined ? result.data : data;
    await fileWrite(table, next);
    return result && result.value !== undefined ? result.value : next;
  });
  queues[table] = run.catch(() => {});
  return run;
}

/* ---------------------------------------------------------------- public */

// DATABASE_URL is what the Neon integration sets by default; POSTGRES_URL is
// the same database under Vercel's older name, accepted too.
function dbUrl() { return process.env.DATABASE_URL || process.env.POSTGRES_URL || ""; }
const usePg = () => !!dbUrl();
const writable = () => usePg() || !process.env.VERCEL;

/** The table's current contents. */
async function read(table) {
  if (usePg()) return (await pgRead(table)).data;
  return fileRead(table);
}

/**
 * Change a table safely. fn(data) mutates data in place, or returns
 * { data, value } to replace it and hand a value back to the caller.
 * Throw from fn to abort without saving.
 */
async function update(table, fn) {
  if (!writable()) throw new StoreUnavailable();
  return usePg() ? pgUpdate(table, fn) : fileUpdate(table, fn);
}

/* ---------------------------------------------------------------- uploaded images */

// Pictures uploaded in the admin panel (store items, raffle thumbnails). Kept
// in their own table so reading the store or raffles never loads image data.
let imagesReady = null;
function ensureImages() {
  if (!imagesReady) {
    imagesReady = sql()`CREATE TABLE IF NOT EXISTS rekoj_images (
      id text PRIMARY KEY, mime text NOT NULL, data text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`.catch((err) => { imagesReady = null; throw err; });
  }
  return imagesReady;
}
const imageFile = (id) => path.join(DATA_DIR, "images", id + ".json");

/** Save an image (buf: Buffer). */
async function putImage(id, mime, buf) {
  if (usePg()) {
    await ensureImages();
    await sql()`INSERT INTO rekoj_images (id, mime, data) VALUES (${id}, ${mime}, ${buf.toString("base64")}) ON CONFLICT (id) DO NOTHING`;
    return;
  }
  if (!writable()) throw new StoreUnavailable();
  await fsp.mkdir(path.join(DATA_DIR, "images"), { recursive: true });
  await fsp.writeFile(imageFile(id), JSON.stringify({ mime, data: buf.toString("base64") }));
}

/** { mime, buf } or null. */
async function getImage(id) {
  if (usePg()) {
    await ensureImages();
    const rows = await sql()`SELECT mime, data FROM rekoj_images WHERE id = ${id}`;
    return rows.length ? { mime: rows[0].mime, buf: Buffer.from(rows[0].data, "base64") } : null;
  }
  try {
    const x = JSON.parse(await fsp.readFile(imageFile(id), "utf8"));
    return { mime: x.mime, buf: Buffer.from(x.data, "base64") };
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

module.exports = { read, update, newId, putImage, getImage, StoreUnavailable, storageKind: () => (usePg() ? "postgres" : process.env.VERCEL ? "none" : "files") };
