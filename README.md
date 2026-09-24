# RekoJ Leaderboard

Static site built from the Figma file "Rekoj.org (Copy)". It has no build step and no dependencies.

## Run locally
Open `index.html` directly, or serve the folder:

    npx serve .

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
| `RAZED_REFERRAL_KEY` | yes | the `X-Referral-Key` for razed.com |
| `RAZED_API_URL` | no | overrides the endpoint |
| `RAZED_REFERRAL_CODE` | no | defaults to the code in `data.js` |
| `RAZEDIO_REFERRAL_KEY` / `RAZEDIO_API_URL` / `RAZEDIO_REFERRAL_CODE` | no | for Razed.IO, once that API is available |

For local development, copy `.env.example` to `.env.local`, fill it in and run
`npx vercel dev` (the plain static server has no `/api` routes). `.env*` files are
gitignored.

If the API is unreachable or no key is set, the page falls back to the `entries`
in `data.js`, so it never renders empty.

The response shape is read tolerantly (`rowsFrom`/`mapRow` in the function accept
the common field names). Once the real shape is known, those two functions are the
only place that needs changing.

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
