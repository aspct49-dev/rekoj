/*
 * Leaderboard configuration.
 *
 * This is the single source of truth for both the page and the serverless
 * function in api/leaderboard.js, so periods and prizes can never drift apart.
 *
 * Every board runs monthly and ends on the month's last day at
 * schedule.endHour in schedule.timeZone (21:00 Paris time: CET in winter,
 * CEST in summer). The next month starts the moment the last one ends, so
 * nothing needs editing month to month. season(board, at) works out the
 * month running at `at`.
 *
 * prizes    prize per place, 1st first, for every month (its length is how
 *           many places the board pays and shows).
 * months    months that differ from the usual: { "2026-10": { from, prizes } }.
 *           `from` is the UTC day it started counting. Old months stay listed
 *           so their past winners show the prizes they had.
 * entries   shown when the API is unreachable (local preview).
 *
 * Razed counts whole UTC days, so a Razed month counts from the first UTC
 * midnight after the last one ended; Razed.IO counts to the second.
 */
(function (root) {
  root.REKOJ_CONFIG = {
    code: "REKOJ",
    defaultBoard: "razed",
    maskNames: true,
    // firstMonth: the first month whose winners are kept (Past winners)
    schedule: { timeZone: "Europe/Paris", endHour: 21, firstMonth: "2026-10" },

    boards: {
      razed: {
        name: "Razed",
        visitUrl: "https://www.razed.com/signup/?raf=rekoj",
        prizes: [2500, 1250, 500, 200, 175, 140, 100, 65, 45, 25],
        months: {
          "2026-10": { from: "2026-09-20", prizes: [1500, 750, 200, 150, 125, 100, 75, 50, 30, 20] },
        },
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
        visitUrl: "https://razed.io/?referralCode=rekoj",
        prizes: [250, 125, 60, 40, 25],
        months: {
          "2026-10": { from: "2026-09-20" },
        },
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

  /* ---------------- the monthly schedule ---------------- */

  var C = root.REKOJ_CONFIG;
  var DAY = 86400000;

  // How far `zone` is ahead of UTC at instant `at`, in ms.
  function zoneOffset(at, zone) {
    var p = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(at).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000;
  }

  // When month `m` (0-11) of year `y` ends: its last day at endHour, local time.
  function monthEnd(y, m) {
    var s = C.schedule, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var wall = Date.UTC(y, m, last, s.endHour), at = wall;
    for (var i = 0; i < 2; i++) at = wall - zoneOffset(at, s.timeZone); // twice: settles across a clock change
    return at;
  }

  /** One board's month: { id: "2026-11", name, board, start, end, prizes, places, pool, from? } */
  function month(key, id) {
    var board = C.boards[key], y = +id.slice(0, 4), m = +id.slice(5, 7) - 1;
    var over = (board.months || {})[id] || {};
    var prizes = over.prizes || board.prizes;
    var start = over.from ? Date.parse(over.from + "T00:00:00Z") : monthEnd(y, m - 1);
    return {
      id: id, board: key,
      name: new Date(Date.UTC(y, m, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      start: start, end: monthEnd(y, m),
      // Razed's first whole UTC day (a month that starts at 21:00 counts from the next midnight)
      firstDay: new Date(Math.ceil(start / DAY) * DAY).toISOString().slice(0, 10),
      prizes: prizes, places: prizes.length,
      pool: prizes.reduce(function (a, b) { return a + b; }, 0),
    };
  }

  /** The month running at `at` (default now). */
  C.season = function (key, at) {
    at = at == null ? Date.now() : at;
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: C.schedule.timeZone, year: "numeric", month: "numeric" })
      .formatToParts(at).forEach(function (x) { p[x.type] = x.value; });
    var y = +p.year, m = +p.month - 1;
    if (at >= monthEnd(y, m)) { m++; if (m > 11) { m = 0; y++; } }
    return month(key, y + "-" + (m < 9 ? "0" : "") + (m + 1));
  };
  /** A month by id ("2026-10"). */
  C.month = month;
  /** The month before `s`. */
  C.previous = function (s) { return C.season(s.board, s.start - 1); };
  /** "$5,000" */
  C.poolText = function (s) { return "$" + s.pool.toLocaleString("en-US"); };
})(typeof window !== "undefined" ? window : (typeof module !== "undefined" ? (module.exports = {}) : this));
