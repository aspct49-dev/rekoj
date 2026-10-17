(function () {
  "use strict";

  var config = window.REKOJ_CONFIG;
  var boards = config.boards;
  var body = document.body;
  var $ = function (id) { return document.getElementById(id); };

  var state = { board: null, entries: {}, timer: null, refresh: null };

  /* ---------------- helpers ---------------- */

  function money(n, decimals) {
    return Number(n || 0).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function maskName(name) {
    if (!config.maskNames || !name) return name || "---";
    return name.length <= 4 ? name + "***" : name.slice(0, 4) + "***";
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  // Players from the API arrive without a picture, so a place falls back to
  // the design's own avatar for that position.
  function avatarFor(key, place, entry) {
    if (entry && entry.avatar) return entry.avatar;
    var a = boards[key].assets;
    if (place <= 3) return (a.podiumAvatars || [])[place - 1] || a.rowAvatar;
    return a.rowAvatar;
  }

  // The prize for a place comes from the board's prize table; an entry may
  // still carry its own `prize` to override it.
  function prizeFor(key, place) {
    var e = (state.entries[key] || boards[key].entries || [])[place - 1];
    if (e && e.prize != null) return e.prize;
    return (boards[key].prizes || [])[place - 1] || 0;
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  /* ---------------- data ---------------- */

  // Returns entries for a board. If `apiUrl` is set, fetches JSON from it.
  // The API should return an array (or { entries: [...] }) of objects with
  // name / avatar / wagered / prize — or provide `mapResponse(json)` on the
  // board config to convert whatever shape your endpoint returns.
  function loadEntries(key) {
    var board = boards[key];
    if (!board.apiUrl) return Promise.resolve(board.entries || []);

    return fetch(board.apiUrl, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        if (typeof board.mapResponse === "function") return board.mapResponse(json);
        var entries = Array.isArray(json) ? json : json.entries || [];
        return entries.length ? entries : board.entries || [];
      })
      .catch(function (err) {
        console.warn("[rekoj] Failed to load " + key + " leaderboard, using static data.", err);
        return board.entries || [];
      });
  }

  /* ---------------- rendering ---------------- */

  function renderPodium(key, entries) {
    var board = boards[key];
    var podium = $("podium");
    podium.innerHTML = "";

    var boxes = { 1: board.assets.box1st, 2: "assets/shared/box-2nd.png", 3: "assets/shared/box-3rd.png" };
    var gifts = { 1: board.assets.gift1st, 2: "assets/shared/gift-2nd.svg", 3: "assets/shared/gift-3rd.svg" };

    for (var place = 1; place <= 3; place++) {
      var e = entries[place - 1] || {};
      var card = el("article", "card card--" + place);
      card.setAttribute("aria-label", "Place " + place);
      card.innerHTML =
        '<img class="card__box" src="' + boxes[place] + '" alt="" width="281" height="349" />' +
        '<div class="card__details">' +
          '<div class="card__avatar">' +
            '<div class="card__avatar-img">' +
              '<img src="' + esc(avatarFor(key, place, e)) + '" alt="" loading="lazy" />' +
            "</div>" +
            '<span class="card__place">' + place + "</span>" +
          "</div>" +
          '<p class="card__name grad-text">' + esc(maskName(e.name)) + "</p>" +
          '<div class="card__wager">' +
            '<span class="card__wager-label grad-text">Wagered</span>' +
            '<span class="card__wager-amount grad-text">$' + money(e.wagered, e.wagered >= 10000 ? 0 : 2) + "</span>" +
          "</div>" +
          '<p class="card__prize"><span class="d">$</span>' + money(prizeFor(key, place), 0) + "</p>" +
          '<div class="card__tag"><img src="' + gifts[place] + '" alt="" /><span class="grad-text">Prize</span></div>' +
        "</div>";
      podium.appendChild(card);
    }
  }

  function renderRows(key, entries) {
    var list = $("rows");
    var last = boards[key].places || 10;
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

    body.setAttribute("data-board", key);
    // Keep the served title's shape so switching boards doesn't cost the
    // keywords search engines index.
    document.title = board.prizePool + " Monthly " + board.name + " Leaderboard | RekoJ";

    $("prizePool").textContent = board.prizePool;

    var heading = $("seoHeading");
    if (heading) {
      heading.textContent =
        board.prizePool + " monthly leaderboard for " + board.name +
        " players under code " + config.code;
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
    var entries = state.entries[key] || boards[key].entries || [];
    renderPodium(key, entries);
    renderRows(key, entries);
  }

  /* ---------------- countdown ---------------- */

  function endTime(key) {
    var ends = boards[key].endsAt;
    if (ends) return new Date(ends).getTime();
    var now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  }

  function startCountdown(key) {
    clearInterval(state.timer);
    var parts = {};
    Array.prototype.forEach.call(document.querySelectorAll("#countdown [data-t]"), function (b) {
      parts[b.getAttribute("data-t")] = b;
    });

    function tick() {
      var diff = Math.max(0, endTime(key) - Date.now());
      var s = Math.floor(diff / 1000);
      parts.d.textContent = pad(Math.floor(s / 86400));
      parts.h.textContent = pad(Math.floor((s % 86400) / 3600));
      parts.m.textContent = pad(Math.floor((s % 3600) / 60));
      parts.s.textContent = pad(s % 60);
    }
    tick();
    state.timer = setInterval(tick, 1000);
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
      if (state.board === key) render(key);
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

  /* ---------------- copy code ---------------- */

  var toastTimer;
  function toast(html) {
    var t = $("toast");
    t.innerHTML = html;
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-visible"); }, 1800);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  function initCopy() {
    var btn = $("copyCode");
    btn.addEventListener("click", function () {
      copyText(config.code).then(
        function () {
          btn.classList.add("is-copied");
          setTimeout(function () { btn.classList.remove("is-copied"); }, 1200);
          toast('Code <span class="accent">' + esc(config.code) + "</span> copied to clipboard");
        },
        function () { toast("Couldn't copy — the code is " + esc(config.code)); }
      );
    });
  }

  /* ---------------- init ---------------- */

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-code]"), function (n) {
      n.textContent = config.code;
    });
    $("copyCode").setAttribute("aria-label", "Copy code " + config.code);
    Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (n) {
      n.textContent = new Date().getFullYear();
    });

    initPicker();
    initCopy();

    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get("board");
    setBoard(fromUrl || storageGet("rekoj-board") || config.defaultBoard, { fromUrl: !!fromUrl });

    // Poll live boards every 60s.
    state.refresh = setInterval(function () {
      Object.keys(boards).forEach(function (key) {
        if (!boards[key].apiUrl) return;
        loadEntries(key).then(function (entries) {
          state.entries[key] = entries;
          if (state.board === key) render(key);
        });
      });
    }, 60000);
  }

  init();
})();
