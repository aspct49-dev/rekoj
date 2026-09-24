/*
 * Leaderboard configuration.
 *
 * This is the single source of truth for both the page and the serverless
 * function in api/leaderboard.js, so periods and prizes can never drift apart.
 *
 * period.from / period.to  the days the board counts, inclusive, in UTC.
 * endsAt                   when the countdown hits zero (ISO, UTC).
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
        visitUrl: "https://www.razed.com/",
        places: 10,
        prizes: [1500, 750, 200, 150, 125, 100, 75, 50, 30, 20],
        period: { from: "2026-09-24", to: "2026-10-31" },
        endsAt: "2026-11-01T00:00:00Z",
        apiUrl: "/api/leaderboard?board=razed",
        referralCode: "rekoj",
        assets: {
          bg: "assets/razed/bg.jpg",
          visitLogo: "assets/razed/visit-logo-dark.png",
          box1st: "assets/razed/box-1st.png",
          gift1st: "assets/razed/gift-1st.svg",
          symbolLeft: "assets/razed/symbol-left.png",
          symbolRight: "assets/razed/symbol-right.png",
          iconPlace: "assets/razed/icon-place.svg",
          iconUser: "assets/razed/icon-user.svg",
          iconGift: "assets/razed/icon-gift.svg",
        },
        entries: [
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 329832 },
          { name: "Admo***", avatar: "assets/razed/avatar-2.png", wagered: 298104 },
          { name: "Admo***", avatar: "assets/razed/avatar-3.png", wagered: 254991 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 198407.38 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 175220.15 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 143988.02 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 121455.6 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 98712.44 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 76301.9 },
          { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 54880.73 },
        ],
      },

      razedio: {
        name: "Razed.IO",
        prizePool: "$500.00",
        visitUrl: "https://razed.io/",
        places: 5,
        prizes: [250, 125, 60, 40, 25],
        period: { from: "2026-09-24", to: "2026-10-31" },
        endsAt: "2026-11-01T00:00:00Z",
        // Razed.IO runs on a different platform from razed.com and its affiliate
        // endpoint is unknown, so this falls back to `entries` below until
        // RAZEDIO_API_URL and RAZEDIO_REFERRAL_KEY are set (see README).
        apiUrl: "/api/leaderboard?board=razedio",
        referralCode: "rekoj",
        assets: {
          bg: "assets/razedio/bg.jpg",
          visitLogo: "assets/razedio/visit-logo-dark.png",
          box1st: "assets/razedio/box-1st.png",
          gift1st: "assets/razedio/gift-1st.svg",
          symbolLeft: "assets/razedio/symbol-left.png",
          symbolRight: "assets/razedio/symbol-right.png",
          iconPlace: "assets/razedio/icon-place.svg",
          iconUser: "assets/razedio/icon-user.svg",
          iconGift: "assets/razedio/icon-gift.svg",
        },
        entries: [
          { name: "Admo***", avatar: "assets/razedio/avatar-1.png", wagered: 84210 },
          { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 71540 },
          { name: "Admo***", avatar: "assets/razedio/avatar-3.png", wagered: 62115 },
          { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 48903.25 },
          { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 33470.8 },
        ],
      },
    },
  };
})(typeof window !== "undefined" ? window : (typeof module !== "undefined" ? (module.exports = {}) : this));
