/*
 * Points Store items and raffles.
 *
 * These are the starting store items and raffles: the server copies them
 * into the database the first time it runs, and from then on they are
 * managed in the admin panel (/admin). The page also falls back to them if
 * the API can't be reached.
 *
 * Store item
 *   name   shown under the picture
 *   cost   price in Rekoj points
 *   tier   "gold" | "red" | "purple" | "blue" — sets the card's border,
 *          backdrop and button colour
 *   image  "xbox" | "af1" | "keyboard" | "bonusbuy" (see STORE_IMAGES)
 *
 * Raffle
 *   game     first title line;  prize  second title line
 *   value    prize value in USD, used by "Reward: Ascending / Descending"
 *   winners, entries   numbers shown on the card
 *   thumb    "wanted" | "gates" | "sweet-bonanza" (see RAFFLE_THUMBS)
 *   endsAt   ISO date, UTC (active raffles: drives the countdown)
 *   endedAt  ISO date, UTC (past raffles: "Ended Sep 29th")
 */
(function (root) {
  var STORE_IMAGES = {
    xbox: "/assets/store/item-xbox.webp",
    af1: "/assets/store/item-af1.webp",
    keyboard: "/assets/store/item-keyboard.webp",
    bonusbuy: "/assets/store/item-bonusbuy.webp",
  };

  var RAFFLE_THUMBS = {
    wanted: "/assets/raffles/thumb-wanted.webp",
    gates: "/assets/raffles/thumb-gates.webp",
    "sweet-bonanza": "/assets/raffles/thumb-sweet-bonanza.webp",
  };

  function repeat(item, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(item);
    return out;
  }

  var xbox = { name: "Xbox One Console", cost: 500000, tier: "gold", image: "xbox" };
  var af1 = { name: "Air Force 1 Low", cost: 250000, tier: "red", image: "af1" };
  var keyboard = { name: "Steelseries Apex 3", cost: 75000, tier: "purple", image: "keyboard" };
  var bonusBuy = { name: "Wanted $40 Bonus Buy", cost: 25000, tier: "blue", image: "bonusbuy" };

  var wanted = {
    game: "Wanted Dead or Wild", prize: "$100 Bonus Buy", value: 100,
    winners: 5, entries: 321, thumb: "wanted", endsAt: "2026-10-20T08:00:00Z",
  };
  var gates = {
    game: "Gates of Olympus 1000", prize: "$80 Bonus Buy", value: 80,
    winners: 5, entries: 321, thumb: "gates", endsAt: "2026-10-20T08:00:00Z",
  };
  var sweet = {
    game: "Sweet Bonanza 1000", prize: "$250 Bonus Buy", value: 250,
    winners: 1, entries: 242, thumb: "sweet-bonanza", endedAt: "2026-09-29T20:00:00Z",
  };

  root.REKOJ_CONTENT = {
    // false: /points-store shows "Coming soon" and the server refuses purchases.
    // Set to true to open the store (items are managed in admin → Store).
    storeOpen: false,

    // How viewers earn Rekoj points (100 points = $1).
    //   watch: set up in BotRix (the site only shows these numbers; keep them in sync).
    //   wager: credited by the site for approved casino links, per calendar month (UTC),
    //          counting from the day the link was approved. Remove a casino to stop it.
    earn: {
      pointsPerDollar: 100,
      startsOn: "2026-10-17", // wager before this day (UTC) never earns points
      watch: { everyMinutes: 5, points: 1, subPoints: 2 }, // no monthly cap (BotRix can't cap)
      wager: {
        razed: { per: 10000, points: 250 },
      },
    },

    storeImages: STORE_IMAGES,
    raffleThumbs: RAFFLE_THUMBS,

    store: [].concat(repeat(xbox, 5), repeat(af1, 5), repeat(keyboard, 5), repeat(bonusBuy, 5)),

    raffles: {
      active: [wanted, gates, wanted, wanted, wanted, wanted, wanted, wanted, wanted],
      past: [sweet, sweet, sweet],
    },
  };
})(typeof window !== "undefined" ? window : (typeof module !== "undefined" ? (module.exports = {}) : this));
