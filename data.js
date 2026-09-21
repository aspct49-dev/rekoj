/*
 * Leaderboard configuration + data.
 *
 * Edit this file to update the leaderboards. Each board can either use the
 * static `entries` below, or pull live data from `apiUrl` (see README.md).
 *
 * entries: ordered 1st → 10th.
 *   name     display name (already masked, or set `maskNames: true`)
 *   avatar   image path/URL
 *   wagered  number (USD)
 *   prize    number (USD)
 *
 * endsAt: ISO date string (e.g. "2026-10-01T00:00:00Z"), or null to count
 *         down to the start of next month (UTC) and reset automatically.
 */
window.REKOJ_CONFIG = {
  code: "REKOJ",
  defaultBoard: "razed",
  maskNames: false,

  boards: {
    razed: {
      name: "Razed",
      prizePool: "$5,000",
      visitUrl: "https://www.razed.com/",
      endsAt: null,
      apiUrl: null,
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
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 329832, prize: 2500 },
        { name: "Admo***", avatar: "assets/razed/avatar-2.png", wagered: 329832, prize: 2500 },
        { name: "Admo***", avatar: "assets/razed/avatar-3.png", wagered: 329832, prize: 2500 },
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razed/avatar-1.png", wagered: 585407.38, prize: 9000 },
      ],
    },

    razedio: {
      name: "Razed.IO",
      prizePool: "$500.00",
      visitUrl: "https://razed.io/",
      endsAt: null,
      apiUrl: null,
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
        { name: "Admo***", avatar: "assets/razedio/avatar-1.png", wagered: 329832, prize: 2500 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 329832, prize: 2500 },
        { name: "Admo***", avatar: "assets/razedio/avatar-3.png", wagered: 329832, prize: 2500 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 585407.38, prize: 9000 },
        { name: "Admo***", avatar: "assets/razedio/avatar-2.png", wagered: 585407.38, prize: 9000 },
      ],
    },
  },
};
