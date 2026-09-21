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
  - `entries`: places 1–10, in order (`name`, `avatar`, `wagered`, `prize`).

### Live data
Set a board's `apiUrl` to a JSON endpoint that returns `[{ name, avatar, wagered, prize }, ...]`
(or add `mapResponse(json)` to convert another shape). The page fetches it on load and every 60 seconds,
and falls back to the static `entries` if the request fails. Keep any Razed API keys on a server or proxy.
Never put them in `data.js`.

## Board switching
The Razed and Razed.IO buttons switch boards. You can link straight to one with `?board=razed` or `?board=razedio`.
The page remembers the viewer's last choice.

## Fonts
- Rubik comes from Google Fonts.
- **PP Neue Corp (Normal Ultrabold)** is used for the headline, top-3 names and badges. It's a paid font from
  Pangram Pangram. Put the licensed `PPNeueCorp-NormalUltrabold.woff2` file in `fonts/` and the page uses it
  automatically. Until then, Archivo Black is used in its place.
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
