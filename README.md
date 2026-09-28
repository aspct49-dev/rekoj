# RekoJ Leaderboard

Static site built from the Figma file "Rekoj.org (Copy)". It has no build step and no dependencies.

## Run locally
    node dev-server.js        # http://127.0.0.1:5173, serves the /api routes too

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
        ?referral_code=rekoj&from=2026-09-24&to=2026-10-31&top=10
    X-Referral-Key: <key>

    { "current_page": 1, "last_page": 1, "per_page": 10, "total": 1,
      "from": "2026-09-24", "to": "2026-10-31",
      "data": [ { "username": "Affelito", "referred_by_code": "rekoj",
                  "wagered": "0.050000000000000000" } ] }

Note `referral_code` is singular; the plural form returns 404, and a single-day window
returns nothing, so the whole period is always sent. This API carries no avatars.

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
The Razed and Razed.IO buttons switch boards. You can link straight to one with `?board=razed` or `?board=razedio`.
The page remembers the viewer's last choice.

## Fonts
- Rubik comes from Google Fonts.
- **PP Neue Corp (Normal Ultrabold)**, from Pangram Pangram, is used for the headline, top-3 names and badges.
  It's served from `fonts/PPNeueCorp-NormalUltrabold.woff2`. If that file is missing, variable Archivo
  (sized to match) is used in its place.
- The "RekoJ" wordmark uses Bomber Escort. It's exported from Figma as outlined SVG
  (`assets/shared/rekoj-wordmark.svg`), so no font license is needed.

## Pages
- `index.html`: the leaderboard.
- `terms.html` / `privacy.html`: Terms of Service and Privacy Policy. Update the "Last updated" date when you change the text.

The footer (disclaimer, Explore links, socials, policy links) is repeated in all three pages. If you change it, edit all three.

## Hosting on Vercel
The site is plain static files, so nothing needs building.
1. In Vercel, choose **Add New → Project** and import `aspct49-dev/rekoj`.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. Deploy. Every push to `main` redeploys automatically.

`vercel.json` gives the pages clean URLs (`/terms`, `/privacy`) and sets caching for images and fonts. A missing page shows `404.html`.

## SEO
- Canonical domain is **https://rekoj.vercel.app** — it appears in the `<link rel="canonical">`
  tags, the Open Graph URLs, `sitemap.xml`, `robots.txt` and the JSON-LD in `index.html`.
  If the domain changes, search for `rekoj.org` and replace it everywhere.
- The share image is `assets/shared/og-image.png` (1200x630). It is a screenshot of a
  small template rendered with the site's own fonts and art; regenerate it if the prize
  pool changes.
- `sitemap.xml` lists the three real pages; `robots.txt` points at it and blocks `/api/`.
  `404.html` is `noindex`.
- The page has one `<h1>`, visually hidden because the visible headline is split across
  two styled lines. It and the `<title>` follow the selected board.
