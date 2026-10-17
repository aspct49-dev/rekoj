/*
 * Leaderboard configuration.
 *
 * This is the single source of truth for both the page and the serverless
 * function in api/leaderboard.js, so periods and prizes can never drift apart.
 *
 * period.from / period.to  the days the board counts, inclusive, in UTC. Sent
 *                          to the affiliate API as its `from` / `to` dates.
 * endsAt                   when the countdown hits zero. Always UTC: write it
 *                          with a trailing Z, e.g. the instant 31 Oct ends is
 *                          "2026-11-01T00:00:00Z".
 * places                   how many places the board pays and shows.
 * prizes                   prize per place, 1st first. Must match `places`.
 * entries                  shown when the API is unreachable (local preview).
 */
(function (root) {
  root.REKOJ_CONFIG = {
    code: "REKOJ",
    defaultBoard: "razed",
    maskNames: true,

    boards: {
      razed: {
        name: "Razed",
        prizePool: "$3,000",
        visitUrl: "https://www.razed.com/signup/?raf=rekoj",
        places: 10,
        prizes: [1500, 750, 200, 150, 125, 100, 75, 50, 30, 20],
        period: { from: "2026-09-20", to: "2026-10-31" },
        endsAt: "2026-11-01T00:00:00Z",
        apiUrl: "/api/leaderboard?board=razed",
        apiFlavor: "razed",
        referralCode: "rekoj",
        assets: {
          bg: "assets/razed/bg.webp",
          visitLogo: "assets/razed/visit-logo-dark.webp",
          box1st: "assets/razed/box-1st.webp",
          gift1st: "assets/razed/gift-1st.svg",
          symbolLeft: "assets/razed/symbol-left.webp",
          symbolRight: "assets/razed/symbol-right.webp",
          iconPlace: "assets/razed/icon-place.svg",
          iconUser: "assets/razed/icon-user.svg",
          iconGift: "assets/razed/icon-gift.svg",
          // Used for players the API gives no picture for: the three podium
          // characters, then a single face for the rows, as in the design.
          podiumAvatars: [
            "assets/razed/avatar-1.webp",
            "assets/razed/avatar-2.webp",
            "assets/razed/avatar-3.webp",
          ],
          rowAvatar: "assets/razed/avatar-1.webp",
        },
        entries: [
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 329832 },
          { name: "Admo***", avatar: "assets/razed/avatar-2.webp", wagered: 298104 },
          { name: "Admo***", avatar: "assets/razed/avatar-3.webp", wagered: 254991 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 198407.38 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 175220.15 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 143988.02 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 121455.6 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 98712.44 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 76301.9 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.webp", wagered: 54880.73 },
        ],
      },

      razedio: {
        name: "Razed.IO",
        prizePool: "$500.00",
        visitUrl: "https://razed.io/?referralCode=rekoj",
        places: 5,
        prizes: [250, 125, 60, 40, 25],
        period: { from: "2026-09-20", to: "2026-10-31" },
        endsAt: "2026-11-01T00:00:00Z",
        // Razed.IO has its own API (see api/leaderboard.js) and needs
        // RAZEDIO_API_KEY set; without it the page falls back to `entries`.
        apiUrl: "/api/leaderboard?board=razedio",
        apiFlavor: "razedio",
        referralCode: "rekoj",
        assets: {
          bg: "assets/razedio/bg.webp",
          visitLogo: "assets/razedio/visit-logo-dark.webp",
          box1st: "assets/razedio/box-1st.webp",
          gift1st: "assets/razedio/gift-1st.svg",
          symbolLeft: "assets/razedio/symbol-left.webp",
          symbolRight: "assets/razedio/symbol-right.webp",
          iconPlace: "assets/razedio/icon-place.svg",
          iconUser: "assets/razedio/icon-user.svg",
          iconGift: "assets/razedio/icon-gift.svg",
          podiumAvatars: [
            "assets/razedio/avatar-1.webp",
            "assets/razedio/avatar-2.webp",
            "assets/razedio/avatar-3.webp",
          ],
          rowAvatar: "assets/razedio/avatar-2.webp",
        },
        entries: [
          { name: "Admo***", avatar: "assets/razedio/avatar-1.webp", wagered: 84210 },
          { name: "Admo***", avatar: "assets/razedio/avatar-2.webp", wagered: 71540 },
          { name: "Admo***", avatar: "assets/razedio/avatar-3.webp", wagered: 62115 },
          { name: "Admo***", avatar: "assets/razedio/avatar-2.webp", wagered: 48903.25 },
          { name: "Admo***", avatar: "assets/razedio/avatar-2.webp", wagered: 33470.8 },
        ],
      },
    },
  };
})(typeof window !== "undefined" ? window : (typeof module !== "undefined" ? (module.exports = {}) : this));
