# RekoJ Leaderboard

Static site built from the Figma file "Rekoj.org (Copy)". It has no build step. The only dependency is the Postgres
driver the API functions use (`npm install` once; Vercel installs it on deploy).

## Run locally
    npm install
    node dev-server.js        # http://localhost:5173, serves the /api routes and overlays too

Open it as **http://localhost:5173** (not 127.0.0.1) when testing Kick login, because that is the
redirect URL registered with Kick. Without `DATABASE_URL`, orders, raffles and store edits are saved
as JSON in `.data/` (gitignored).

`dev-server.js` reads `.env.local`, so the leaderboard shows live data exactly as in
production. `npx vercel dev` works the same way. Opening `index.html` directly, or any
plain static server, has no `/api` routes, so the page falls back to the sample rows.

## Editing the leaderboards
Everything you can change is in `data.js`:
- `code`: the affiliate code shown on the page and copied by the button.
- `boards.razed` / `boards.razedio`:
  - `prizePool`: the title amount.
  - `visitUrl`: where "VISIT" goes. Put your affiliate or referral link here.
  - `endsAt`: countdown target (ISO date). `null` counts down to the 1st of next month (UTC).
  - `places`: how many places the board pays and shows (10 for Razed, 5 for Razed.IO).
  - `prizes`: the prize per place, 1st first. Must have `places` entries.
  - `period`: the days the board counts, inclusive, UTC. Sent to the API as `from`/`to`.
  - `entries`: fallback rows used when the API is unreachable (`name`, `avatar`, `wagered`).

### Live data (Razed API)
`api/leaderboard.js` is a serverless function that calls the casino's affiliate API
and returns only the names, avatars and amounts the page needs. **The referral key
stays on the server**: it is read from an environment variable, is never sent to the
browser, and must never be committed.

Set it in Vercel under **Project → Settings → Environment Variables**:

| Variable | Required | Notes |
|---|---|---|
| `RAZED_REFERRAL_KEY` | yes | razed.com key, sent as `X-Referral-Key` |
| `RAZEDIO_API_KEY` | yes | razed.io key (64 hex chars), sent as `x-api-key` |
| `RAZED_API_URL` / `RAZEDIO_API_URL` | no | override the endpoints |
| `RAZED_REFERRAL_CODE` / `RAZEDIO_REFERRAL_CODE` | no | default to the code in `data.js` |

The two casinos run different APIs, so each board names a flavour (`apiFlavor` in
`data.js`) and `FLAVOURS` in `api/leaderboard.js` holds the endpoint, auth header,
parameter names and row shape for each. Adding a third casino means adding one
entry there.

For local development, copy `.env.example` to `.env.local`, fill it in and run
`npx vercel dev` (the plain static server has no `/api` routes). `.env*` files are
gitignored.

If the API is unreachable or no key is set, the page falls back to the `entries`
in `data.js`, so it never renders empty.

Confirmed request and response (razed.com):

    GET https://api.razed.com/player/api/v1/referrals/leaderboard
        ?referral_code=rekoj&from=2026-09-20&to=2026-11-01&top=10
    X-Referral-Key: <key>

    { "current_page": 1, "last_page": 1, "per_page": 10, "total": 1,
      "from": "2026-09-24", "to": "2026-10-31",
      "data": [ { "username": "Affelito", "referred_by_code": "rekoj",
                  "wagered": "0.050000000000000000" } ] }

Note `referral_code` is singular; the plural form returns 404. **`to` is exclusive**: from=to returns
nothing, and to=2026-11-01 means "up to the end of 31 October", so the proxy sends the day after the
period's last day. Windows longer than 45 days are refused (422), `top` goes up to 100, and `page`
pages through the rest. This API carries no avatars.

Razed.IO (`Partner Referral Stats API`):

    GET https://api.razed.io/externals/affiliates
        ?codes=rekoj&startDate=2026-09-20T00:00:00Z&endDate=2026-10-31T23:59:59Z
    x-api-key: <64 hex chars>

    [ { "id": 128394, "username": "player_one",
        "avatar": "https://img.razed.io/avatars/128394.png",
        "wagered": "1540.25", "deposited": "300.00", "stillUnderCode": true } ]

Its dates need an explicit `Z` offset, amounts are decimal strings, and it does carry
avatars. Players who later moved to another affiliate come back with
`stillUnderCode: false`; their wagering under this code still counts, so they are kept.
Poll no faster than once a minute — the page refreshes every 60s, and that API caches
for 60s anyway.

Where a player has no avatar, the page uses the character from the design for that
place. Usernames are masked on the page (`maskNames` in `data.js`).

## Board switching
The Razed and Razed.IO buttons switch boards. You can link straight to one with `/leaderboard?board=razed` or
`/leaderboard?board=razedio`. The page remembers the viewer's last choice. Old links to `/?board=…` (from before the
leaderboard moved off the home page) redirect there.

## Fonts
- Rubik comes from Google Fonts.
- **PP Neue Corp (Normal Ultrabold)**, from Pangram Pangram, is used for the headline, top-3 names and badges.
  It's served from `fonts/PPNeueCorp-NormalUltrabold.woff2`. If that file is missing, variable Archivo
  (sized to match) is used in its place.
- The "RekoJ" wordmark uses Bomber Escort. It's exported from Figma as outlined SVG
  (`assets/shared/rekoj-wordmark.svg`), so no font license is needed.

## Pages
| URL | File | Script | What it is |
|---|---|---|---|
| `/` | `index.html` | `home.js` | Home: hero, bonuses, leaderboard teaser (live Razed top 3), total given away |
| `/leaderboard` | `leaderboard.html` | `app.js` | The Razed / Razed.IO leaderboards |
| `/raffles` | `raffles.html` | `raffles.js` | Active raffles (live countdowns) and the past raffles carousel |
| `/points-store` | `points-store.html` | `store.js` | Points Store grid |
| `/profile` | `profile.html` | `profile.js` | The signed-in viewer's points, linked casino accounts, orders and raffle entries |
| `/admin` | `admin.html` | `admin.js` | Admin panel (admins only) |
| `/overlay/…` | `overlay.html` | `overlay.js` | Transparent stream overlays for OBS |
| `/contact` | `contact.html` | `contact.js` | Contact form (messages land in admin → Messages) |
| `/terms`, `/privacy` | `terms.html`, `privacy.html` | | Policies. Update the "Last updated" date when the text changes. |

Every page loads `data.js` (leaderboard config) and `site.js` (copy-code buttons, the toast, Login, footer year,
the shared podium card, the opt-in analytics). The store and raffles also load `content.js`.

### Store items and raffles
Manage them in the admin panel (`/admin`). `content.js` only holds the starting set: on first run the server copies
its items and raffles into the database, after which the admin panel is the source of truth. The design's sample
raffles are marked "Placeholder from the design" in the admin panel; edit or delete them before going live.
If the API is unreachable the pages fall back to `content.js`, read-only.

## Accounts, points and the admin panel
Viewers sign in with **Kick** (OAuth 2.1 with PKCE, scope `user:read`). Their **Rekoj points** are their
**BotRix** loyalty points on the `rekoj` Kick channel, so they earn points by watching streams, as before.

- **Points Store:** buying checks the balance, takes the points through BotRix and records an order. Orders
  are fulfilled by hand: the admin panel lists them, "Mark sent" closes one, "Reject & refund" gives the points
  back and returns the item to stock.
- **Wager raffles:** see below.
- **Profile:** points, hours watched, linked casino accounts, orders with their status, raffle entries and tickets.
- **Admin panel** (`/admin`, Kick accounts in `ADMIN_KICK_USERNAMES`, default `rekoj,aspect900`): overview and setup
  checks, orders, link requests, store items (add, edit, hide, stock), the raffle manager (below), contact
  messages, points lookup and manual adjustments (logged), players who have signed in, and overlay links.

### Raffle manager (admin → Raffles)
The list shows every raffle with live entries, tickets and the current leader, filtered by Open / Ready to
draw / Drawn, with search, and refreshes every minute. A badge on the tab counts raffles that have ended and
are waiting to be drawn. **Manage** opens a raffle's own page (`/admin#raffles/<id>`, linkable):

- live entries with each player's linked username, wager in the window, tickets and odds (refreshes every minute);
- **End now**, **Edit**, **Duplicate** (a fresh copy with no entries), **Draw winners** / **Redraw**,
  **Copy overlay link** for that raffle, **Export CSV** of the entries, **Delete**;
- **Remove** an entry (with a reason; they can't rejoin unless you **Allow back**);
- the winners with their chance at the draw, the **draw history** (every draw and redraw is kept), and an
  **activity log** of everything that happened to the raffle (created, edited, joined, removed, ended, drawn).

The overview tab shows raffles waiting to be drawn and the latest raffle activity across all raffles.

### Wager raffles
1. **Link.** On `/profile` a viewer enters their Razed and/or Razed.IO username. The request waits in the
   admin panel's **Links** tab, which shows what that username wagered under code REKOJ in the last 30 days
   ("Not found under REKOJ" is a warning sign). An admin approves or rejects it (the reason is shown to the
   viewer). A casino username can belong to only one Kick account. Viewers can withdraw a request that's
   still waiting; only an admin can remove an approved link (**Unlink**, with a reason), and an admin can
   also link someone directly (**Link manually**, or **Link** on the Players tab) once they've logged in once.
2. **Rules.** Each raffle names a casino and its ticket rule: every **$X** wagered gives **Y** tickets, an
   optional minimum wager before any tickets, and an optional cap per player. Wagers count from the raffle's
   "Wagers count from" time until it ends. Razed only reports whole UTC days and at most 45 days at a time,
   so a Razed raffle's window must fit in 45 days; Razed.IO counts to the minute.
3. **Join.** Only viewers with an approved link for that casino can join (one entry each). The join dialog
   shows the rules and their tickets so far; the card then shows "JOINED · N TICKETS". Tickets keep growing
   as they wager until the raffle ends.
4. **Draw.** Once it ends, **Draw winners** fetches fresh wagers (never cached ones), works out everyone's
   tickets and picks winners at random weighted by tickets (`crypto.randomInt`), without repeats. Entries
   with no tickets, or whose link was removed, can't win. The numbers it was drawn with are saved, and the
   **Entries** button shows them with each player's odds. Winners show under Past Raffles and on the overlay.

Wager data comes from `server/wager.js`, using the same keys as the leaderboards (`RAZED_REFERRAL_KEY`,
`RAZEDIO_API_KEY`), cached for a minute.

The server code is in `server/` (`api.js` routes, `kick.js` login, `botrix.js` points, `store.js` storage,
`session.js` signed cookies). `api/router.js` is the single Vercel Function that serves every `/api/*` route
except the leaderboard. POST requests must come from the site itself, and the BotRix bid token never leaves the
server.

### Contact form
`/contact` posts to `/api/contact`. The browser and the server check the same rules (a reply address and a
message of 10–2,000 characters). Spam protection: a hidden field bots fill in, a minimum time before sending,
and a limit of 3 messages per sender per 10 minutes and 6 per hour (senders are told apart by a salted hash of
their IP address; the address itself isn't stored). Messages are saved and shown in **admin → Messages** (a
badge counts new ones); set `CONTACT_DISCORD_WEBHOOK` to also post each one to a Discord channel. If a message
can be neither saved nor forwarded, the visitor sees an error and keeps their text: the form never claims a
message was sent when it wasn't.

### Analytics (optional, off by default)
Set `GA4_ID` at the top of `site.js` to your Google Analytics 4 measurement ID (`G-…`). While it's empty
nothing loads. When set, visitors get a consent banner; the Google tag loads only after they accept, sends one
page view per page, and isn't loaded on the admin panel or the overlays. The Privacy Policy's "cookie settings"
link lets visitors change their mind. The ID is public by nature, so it lives in the page code, not in Vercel.

### Stream overlays
Add these as **Browser Sources** in OBS (transparent background). The admin panel's Overlays tab has copy
buttons and previews.

| URL | Shows |
|---|---|
| `/overlay/leaderboard?board=razed` (or `razedio`, add `&top=5` for fewer rows) | Live leaderboard and countdown |
| `/overlay/raffle` (or `?id=<raffle id>`) | The next raffle to end with a countdown and entries; winners when drawn |
| `/overlay/alerts` | Pops up for each new store order. `?demo=1` loops a sample to position it |

### Header and footer
The nav bar and footer live in `partials/header.html` and `partials/footer.html`. After editing either, run

    node tools/sync-layout.js

which copies them into every page (between `<!-- layout:header -->` / `<!-- layout:footer -->` markers). The site
stays plain static files; there is still nothing to build on Vercel. The highlighted nav item comes from
`<body data-page="…">`.

## Hosting on Vercel
The pages are plain static files, so nothing needs building.
1. In Vercel, choose **Add New → Project** and import `aspct49-dev/rekoj`.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. **Storage → Create Database → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL`.
   Without it the site still works, but buying, joining raffles and admin edits answer "storage isn't set up".
4. Set the environment variables below, then deploy. Every push to `main` redeploys automatically.

| Variable | Notes |
|---|---|
| `RAZED_REFERRAL_KEY`, `RAZEDIO_API_KEY` | Leaderboards (see above) |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | From the Kick developer app |
| `SESSION_SECRET` | Long random string; changing it signs everyone out |
| `BOTRIX_BID` | BotRix bid token. Anyone holding it can change points, so keep it secret |
| `DATABASE_URL` | Set by the Neon integration (leave its prefix as `DATABASE`); `POSTGRES_URL` is accepted too |
| `ADMIN_KICK_USERNAMES` | Optional, default `rekoj,aspect900` |
| `AUTH_URL` | Optional, the public origin if the Kick redirect URL comes out wrong |
| `CONTACT_DISCORD_WEBHOOK` | Optional, a Discord webhook URL; contact messages are also posted there |

The Kick app must list each redirect URL exactly: `https://rekoj.org/api/auth/kick/callback`
(plus `https://rekoj.vercel.app/api/auth/kick/callback` if you ever log in there) and `http://localhost:5173/api/auth/kick/callback` for local testing.

`vercel.json` gives the pages clean URLs (`/terms`, `/privacy`) and sets caching for images and fonts. A missing page shows `404.html`.

## SEO
- Canonical domain is **https://rekoj.org** — it appears in the `<link rel="canonical">`
  tags, the Open Graph URLs, `sitemap.xml`, `robots.txt` and the JSON-LD in `index.html`.
  If the domain changes, search for `rekoj.org` and replace it everywhere. In Vercel → Domains, set
  `rekoj.vercel.app` (and `www.rekoj.org`, if added) to **redirect to rekoj.org** with a 308, so search engines
  only ever see one domain.
- The share image is `assets/shared/og-image.png` (1200x630). It is a screenshot of a
  small template rendered with the site's own fonts and art; regenerate it if the prize
  pool changes.
- `/profile`, `/admin` and the overlays are `noindex` and left out of the sitemap.
- `sitemap.xml` lists the seven public pages; `robots.txt` points at it and blocks `/api/`.
  `404.html` is `noindex` and served with a 404 status. Update `<lastmod>` when a page changes.
- Terms, Privacy and Contact have visible breadcrumbs with matching `BreadcrumbList` JSON-LD. The designed
  pages are one level deep and keep the Figma layout, so they have none.
- Images are WebP (about 86% smaller than the PNG/JPG originals, which stay in `assets/` as sources).
  The share image and the favicon/logo used in JSON-LD stay PNG for crawlers. Images below the first
  screen use `loading="lazy"`; the hero and anything visible on arrival load straight away.

### Google Search Console
1. In Search Console, add a **Domain** property for your domain and verify it with the DNS TXT record it
   gives you at your DNS provider (or use a **URL prefix** property with the **HTML tag** method: paste the
   `<meta name="google-site-verification">` tag into `index.html` where the comment marks the spot, then deploy).
2. Under **Sitemaps**, submit `https://rekoj.org/sitemap.xml`.
- The page has one `<h1>`, visually hidden because the visible headline is split across
  two styled lines. It and the `<title>` follow the selected board.
