/*
 * Vercel Function for every /api/* route except the leaderboard: sign-in,
 * the store, raffles, overlays and the admin panel. vercel.json rewrites
 * /api/* here (a file per route would run into Vercel's function limit);
 * req.url keeps the original path. The logic is in server/api.js, which the
 * local dev server uses too.
 *
 * Environment variables (Vercel → Settings → Environment Variables):
 *   KICK_CLIENT_ID, KICK_CLIENT_SECRET   Kick app (login)
 *   SESSION_SECRET                       signs the login cookie
 *   BOTRIX_BID                           spends/refunds viewers' points
 *   DATABASE_URL                         Neon Postgres (accounts, links, orders, raffles)
 *   RAZED_REFERRAL_KEY, RAZEDIO_API_KEY  wagers for raffle tickets (shared with the leaderboard)
 *   CONTACT_DISCORD_WEBHOOK              optional: contact messages also go to Discord
 *   ADMIN_KICK_USERNAMES                 who can open /admin (default: rekoj,aspect900)
 */
const serveApi = require("../server/api");

module.exports = (req, res) => serveApi(req, res);
