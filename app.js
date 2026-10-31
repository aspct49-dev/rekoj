(function () {
  "use strict";

  var config = window.REKOJ_CONFIG;
  var boards = config.boards;
  var body = document.body;
  var $ = function (id) { return document.getElementById(id); };

  // view: null for this month, or a finished month's id ("2026-10", or
  // "latest"); archive: the finished months once loaded (GET /api/leaderboard/archive).
  var state = { board: null, entries: {}, timer: null, refresh: null, view: null, archive: null, archiveFailed: false };

  /* ---------------- helpers ---------------- */

  // Shared with the other pages (site.js).
  var R = window.Rekoj;
  var money = R.money, maskName = R.maskName, esc = R.esc, pad = R.pad;

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  // Players from the API arrive without a picture, so a place falls back to
  // the design's own avatar for that position.
  function avatarFor(key, place, entry) {
    if (entry && entry.avatar) return entry.avatar;
    var a = boards[key].assets;
    if (place <= 3) return (a.podiumAvatars || [])[place - 1] || a.rowAvatar;
    return a.rowAvatar;
  }

  function season(key) { return config.season(key); }

  // The finished month being looked at, or null for this month.
  function pastMonth() {
    if (!state.view || !state.archive) return null;
    if (state.view === "latest") return state.archive[0] || null;
    return state.archive.filter(function (m) { return m.id === state.view; })[0] || null;
  }
  function pastBoard(key) {
    var m = pastMonth();
    return (m && m.boards[key]) || { prizes: [], pool: 0, entries: [] };
  }

  function prizesFor(key) { return state.view ? pastBoard(key).prizes : season(key).prizes; }
  function entriesFor(key) { return state.view ? pastBoard(key).entries : state.entries[key] || boards[key].entries || []; }

  // The prize for a place comes from the month's prize table; an entry may
  // still carry its own `prize` to override it.
  function prizeFor(key, place) {
    var e = entriesFor(key)[place - 1];
    if (e && e.prize != null) return e.prize;
    return prizesFor(key)[place - 1] || 0;
  }

  // "31 October 2026 at 21:00 CET", in the schedule's time zone.
  function whenText(ms) {
    var tz = config.schedule.timeZone, d = new Date(ms);
    return d.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "long", year: "numeric" }) + " at " +
      d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  /* ---------------- data ---------------- */

  function loadEntries(key) { return R.loadBoard(key); }

  /* ---------------- rendering ---------------- */

  function renderPodium(key, entries) {
    var board = boards[key];
    var podium = $("podium");

    var boxes = { 1: board.assets.box1st, 2: "assets/shared/box-2nd.webp", 3: "assets/shared/box-3rd.webp" };
    var gifts = { 1: board.assets.gift1st, 2: "assets/shared/gift-2nd.svg", 3: "assets/shared/gift-3rd.svg" };

    var html = "";
    for (var place = 1; place <= 3; place++) {
      var e = entries[place - 1] || {};
      html += R.podiumCard({
        place: place,
        entry: e,
        box: boxes[place],
        gift: gifts[place],
        avatar: avatarFor(key, place, e),
        prize: prizeFor(key, place),
      });
    }
    podium.innerHTML = html;
  }

  function renderRows(key, entries) {
    var list = $("rows");
    var last = prizesFor(key).length || (state.view ? 0 : 10);
    list.innerHTML = "";
    for (var place = 4; place <= last; place++) {
      var e = entries[place - 1] || {};
      var row = el("li", "row");
      row.innerHTML =
        '<span class="row__place">' + place + "</span>" +
        '<span class="row__user">' +
          '<img src="' + esc(avatarFor(key, place, e)) + '" alt="" loading="lazy" />' +
          '<span class="row__name">' + esc(maskName(e.name)) + "</span>" +
        "</span>" +
        '<span class="row__wagered"><span class="d">$</span>' + money(e.wagered, 2) + "</span>" +
        '<span class="row__reward"><span class="d">$</span>' + money(prizeFor(key, place), 0) + "</span>";
      list.appendChild(row);
    }
  }

  function applyChrome(key) {
    var board = boards[key];
    var a = board.assets;
    var past = pastMonth();
    var pool = state.view ? "$" + money(pastBoard(key).pool, 0) : config.poolText(season(key));

    body.setAttribute("data-board", key);
    body.classList.toggle("is-past", !!state.view);
    // Keep the served title's shape so switching boards doesn't cost the
    // keywords search engines index.
    document.title = state.view && past
      ? past.name + " " + board.name + " Leaderboard Winners | RekoJ"
      : pool + " Monthly " + board.name + " Leaderboard | RekoJ";

    $("prizePool").textContent = pool;
    $("poolMonthly").textContent = state.view ? (past ? past.name.toUpperCase() : "") : "MONTHLY";

    var heading = $("seoHeading");
    if (heading) {
      heading.textContent = state.view && past
        ? past.name + " " + board.name + " leaderboard winners under code " + config.code
        : pool + " monthly leaderboard for " + board.name + " players under code " + config.code;
    }
    $("symbolLeft").src = a.symbolLeft;
    $("symbolRight").src = a.symbolRight;
    $("iconPlace").src = a.iconPlace;
    $("iconUser").src = a.iconUser;
    $("iconGift").src = a.iconGift;

    var visit = $("visitBtn");
    visit.href = board.visitUrl;
    var visitLogo = $("visitLogo");
    visitLogo.src = a.visitLogo;
    visitLogo.alt = board.name;

    Array.prototype.forEach.call(document.querySelectorAll(".picker__btn"), function (btn) {
      var on = btn.getAttribute("data-board") === key;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });

    var bg = $("heroBg");
    if (bg.getAttribute("src") !== a.bg) {
      bg.classList.add("is-swapping");
      var img = new Image();
      img.onload = img.onerror = function () {
        bg.src = a.bg;
        requestAnimationFrame(function () { bg.classList.remove("is-swapping"); });
      };
      img.src = a.bg;
    }
  }

  function render(key) {
    var entries = entriesFor(key);
    renderPodium(key, entries);
    renderRows(key, entries);
    renderNotice(key);
  }

  /* ---------------- countdown ---------------- */

  var COUNTDOWN_HTML = $("countdown").innerHTML;

  function startCountdown(key) {
    clearInterval(state.timer);
    var label = document.querySelector(".timer__label"), value = $("countdown"), ends = $("timerEnds");

    if (state.view) {
      var past = pastMonth();
      label.textContent = "LEADERBOARD ENDED";
      value.textContent = past ? past.name : "";
      ends.textContent = past ? "Ended " + whenText(past.end) : "";
      return;
    }

    var month = season(key);
    label.textContent = "LEADERBOARD ENDS IN";
    if (!value.querySelector("[data-t]")) value.innerHTML = COUNTDOWN_HTML;
    ends.textContent = "Ends " + whenText(month.end);
    var parts = {};
    Array.prototype.forEach.call(value.querySelectorAll("[data-t]"), function (b) {
      parts[b.getAttribute("data-t")] = b;
    });

    function tick() {
      // The month just ended: the next one starts right away
      if (Date.now() >= month.end) { rollOver(); return; }
      var s = Math.floor(Math.max(0, month.end - Date.now()) / 1000);
      parts.d.textContent = pad(Math.floor(s / 86400));
      parts.h.textContent = pad(Math.floor((s % 86400) / 3600));
      parts.m.textContent = pad(Math.floor((s % 3600) / 60));
      parts.s.textContent = pad(s % 60);
    }
    tick();
    state.timer = setInterval(tick, 1000);
  }

  function rollOver() {
    clearInterval(state.timer);
    state.entries = {};
    state.archive = null; // last month is about to join Past winners
    var key = state.board;
    applyChrome(key);
    render(key);
    startCountdown(key);
    renderPills();
    loadEntries(key).then(function (entries) {
      state.entries[key] = entries;
      if (state.board === key && !state.view) render(key);
    });
  }

  /* ---------------- past winners ---------------- */

  function loadArchive() {
    if (state.archive) return Promise.resolve(state.archive);
    return R.api("/api/leaderboard/archive").then(function (d) {
      state.archive = d.months || [];
      state.archiveFailed = false;
      return state.archive;
    }, function () {
      state.archiveFailed = true;
      return null;
    });
  }

  var ICON_PAST = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.2 7a4.8 4.8 0 1 0 1.4-3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M1.6 1.6v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 4.4V7l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_BACK = '<svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderPills() {
    var html = "";
    if (!state.view) {
      html = '<button type="button" class="lb-pill" data-view="latest">' + ICON_PAST + "PAST WINNERS</button>";
    } else {
      var past = pastMonth(), list = state.archive || [];
      if (list.length > 1) {
        html += '<div class="lb-pills__months" role="radiogroup" aria-label="Finished month">' + list.map(function (m) {
          var on = !!past && m.id === past.id;
          return '<button type="button" role="radio" aria-checked="' + on + '" class="lb-pill' + (on ? " lb-pill--on" : "") + '" data-view="' + esc(m.id) + '">' + esc(m.name.toUpperCase()) + "</button>";
        }).join("") + "</div>";
      }
      html += '<button type="button" class="lb-pill" data-view="">' + ICON_BACK + "CURRENT LEADERBOARD</button>";
    }
    $("lbPills").innerHTML = html;
  }

  function renderNotice(key) {
    var n = $("lbNotice"), text = "";
    if (state.view) {
      if (state.archiveFailed) text = "Couldn\u2019t load past winners. Please try again shortly.";
      else if (!state.archive) text = "Loading past winners\u2026";
      else if (!state.archive.length) text = "No finished leaderboards yet. Each month\u2019s winners are kept here when it ends.";
      else if (!pastMonth()) text = "That month isn\u2019t here. Pick another one above.";
      else if (!pastBoard(key).entries.length) text = "Nobody made the " + boards[key].name + " board that month.";
    }
    n.textContent = text;
    n.hidden = !text;
  }

  // Show a finished month (its id, or "latest"), or this month (null).
  function setView(view, opts) {
    opts = opts || {};
    state.view = view || null;
    if (!opts.fromUrl && window.history && history.pushState) {
      var url = new URL(window.location.href);
      if (state.view) url.searchParams.set("month", state.view); else url.searchParams.delete("month");
      history.pushState(null, "", url);
    }
    var key = state.board;
    var show = function () { applyChrome(key); render(key); startCountdown(key); renderPills(); };
    show();
    if (state.view) loadArchive().then(function () { if (state.view && state.board === key) show(); });
  }

  /* ---------------- switching ---------------- */

  function setBoard(key, opts) {
    if (!boards[key]) key = config.defaultBoard;
    if (key === state.board) return;
    opts = opts || {};

    var boardEl = $("board");
    var first = state.board === null;
    state.board = key;

    storageSet("rekoj-board", key);
    if (!opts.fromUrl && window.history && history.replaceState) {
      var url = new URL(window.location.href);
      url.searchParams.set("board", key);
      history.replaceState(null, "", url);
    }

    function swap() {
      applyChrome(key);
      render(key);
      startCountdown(key);
      renderPills();
      boardEl.classList.remove("is-swapping");
    }

    if (first) {
      swap();
    } else {
      boardEl.classList.add("is-swapping");
      setTimeout(swap, 180);
    }

    // Load fresh data (no-op for static boards) and re-render if still active.
    loadEntries(key).then(function (entries) {
      state.entries[key] = entries;
      if (state.board === key && !state.view) render(key);
    });
  }

  function initPicker() {
    var btns = Array.prototype.slice.call(document.querySelectorAll(".picker__btn"));
    btns.forEach(function (btn, i) {
      btn.addEventListener("click", function () { setBoard(btn.getAttribute("data-board")); });
      btn.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        var next = btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
        next.focus();
        setBoard(next.getAttribute("data-board"));
      });
    });
  }

  /* ---------------- init ---------------- */

  function init() {
    $("copyCode").setAttribute("aria-label", "Copy code " + config.code);

    initPicker();

    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get("board");
    if (params.get("month")) state.view = params.get("month");
    setBoard(fromUrl || storageGet("rekoj-board") || config.defaultBoard, { fromUrl: !!fromUrl });
    if (state.view) setView(state.view, { fromUrl: true });

    $("lbPills").addEventListener("click", function (e) {
      var b = e.target.closest("[data-view]");
      if (b) setView(b.getAttribute("data-view"));
    });
    window.addEventListener("popstate", function () {
      setView(new URLSearchParams(window.location.search).get("month"), { fromUrl: true });
    });

    // Poll live boards every 60s.
    state.refresh = setInterval(function () {
      Object.keys(boards).forEach(function (key) {
        if (!boards[key].apiUrl) return;
        loadEntries(key).then(function (entries) {
          state.entries[key] = entries;
          if (state.board === key && !state.view) render(key);
        });
      });
    }, 60000);
  }

  init();
})();
