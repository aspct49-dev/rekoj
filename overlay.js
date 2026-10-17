/*
 * Stream overlays (OBS Browser Sources). Each polls the public API and
 * redraws itself; nothing here needs a login.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var C = window.REKOJ_CONTENT;
  var root = document.getElementById("overlay");
  var params = new URLSearchParams(location.search);
  var kind = (location.pathname.split("/")[2] || params.get("kind") || "").toLowerCase();
  var esc = R.esc;

  function brand() {
    return '<img class="ov__wordmark" src="/assets/shared/rekoj-wordmark.svg" alt="RekoJ" width="110" height="17" />';
  }

  function countdown(endsAt) {
    var s = Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000));
    return R.pad(Math.floor(s / 86400)) + "D " + R.pad(Math.floor((s % 86400) / 3600)) + "H " +
      R.pad(Math.floor((s % 3600) / 60)) + "M " + R.pad(s % 60) + "S";
  }

  /* ---------------- leaderboard ---------------- */

  function leaderboard() {
    var key = params.get("board") === "razedio" ? "razedio" : "razed";
    var board = R.config.boards[key];
    var top = Math.min(board.places || 10, Math.max(3, Number(params.get("top")) || board.places || 10));
    document.body.setAttribute("data-board", key);
    var entries = board.entries || [];

    function render() {
      var rows = "";
      for (var i = 0; i < top; i++) {
        var e = entries[i] || {};
        rows += '<li class="ov-row' + (i < 3 ? " ov-row--top ov-row--" + (i + 1) : "") + '">' +
          '<span class="ov-row__place">' + (i + 1) + "</span>" +
          '<span class="ov-row__name">' + esc(R.maskName(e.name)) + "</span>" +
          '<span class="ov-row__wager"><span class="accent">$</span>' + R.money(e.wagered || 0, 2) + "</span>" +
          '<span class="ov-row__prize"><span class="accent">$</span>' + R.money((board.prizes || [])[i] || 0, 0) + "</span>" +
        "</li>";
      }
      root.innerHTML =
        '<section class="ov-panel ov-lb">' +
          '<header class="ov-lb__head">' + brand() +
            '<span class="ov-lb__pool"><b>' + esc(board.prizePool) + "</b> " + esc(board.name) + " leaderboard</span></header>" +
          '<p class="ov-lb__timer">Ends in <b data-ov-timer>' + countdown(board.endsAt) + "</b></p>" +
          '<ol class="ov-rows">' + rows + "</ol>" +
          '<p class="ov-foot">Code <b class="accent">' + esc(R.config.code) + "</b> on " + esc(board.name) + "</p>" +
        "</section>";
    }

    function load() {
      R.loadBoard(key).then(function (list) { entries = list; render(); });
    }
    render();
    load();
    setInterval(load, 60000);
    setInterval(function () {
      var t = root.querySelector("[data-ov-timer]");
      if (t) t.textContent = countdown(board.endsAt);
    }, 1000);
  }

  /* ---------------- raffle ---------------- */

  function raffle() {
    var id = params.get("id");
    var shown = "";

    function render(r) {
      if (!r) { root.innerHTML = ""; shown = ""; return; }
      var sig = r.id + r.state + r.entries + r.perDollars + r.ticketsPer + r.casino + (r.winnersList || []).join(",");
      if (sig === shown) return;
      var justDrawn = shown && shown.indexOf(r.id + "drawn") !== 0 && r.state === "drawn";
      shown = sig;
      var thumb = C.raffleThumbs[r.thumb] || r.thumb;
      var body = r.state === "drawn"
        ? '<p class="ov-raffle__label">Winner' + (r.winnersList.length === 1 ? "" : "s") + "</p>" +
          '<ol class="ov-raffle__winners' + (justDrawn ? " is-new" : "") + '">' +
            r.winnersList.map(function (w, i) { return '<li style="--i:' + i + '">' + esc(w) + "</li>"; }).join("") + "</ol>"
        : '<p class="ov-raffle__label">' + (r.state === "open" ? "Ends in" : "Drawing soon") + "</p>" +
          (r.state === "open" ? '<p class="ov-raffle__timer" data-ov-timer data-ends="' + esc(r.endsAt) + '">' + countdown(r.endsAt) + "</p>" : "") +
          '<p class="ov-raffle__entries"><b>' + R.money(r.entries, 0) + "</b> entr" + (r.entries === 1 ? "y" : "ies") + " · join at " + esc(location.host) + "/raffles</p>";
      root.innerHTML =
        '<section class="ov-panel ov-raffle">' +
          '<img class="ov-raffle__thumb" src="' + esc(thumb) + '" alt="" />' +
          '<div class="ov-raffle__main">' + brand() +
            '<h1 class="ov-raffle__title">' + esc(r.game) + (R.raffleSub(r) ? "<span>" + esc(R.raffleSub(r)) + "</span>" : "") + "</h1>" +
            (r.state === "drawn" ? "" : '<p class="ov-raffle__rule"><b>$' + R.money(r.perDollars, r.perDollars % 1 ? 2 : 0) + "</b> wagered on " + esc(r.casinoName) +
              " = <b>" + R.money(r.ticketsPer, 0) + " ticket" + (r.ticketsPer === 1 ? "" : "s") + "</b></p>") + body +
          "</div>" +
        "</section>";
    }

    function load() {
      R.api("/api/overlay/raffle" + (id ? "?id=" + encodeURIComponent(id) : "")).then(function (d) { render(d.raffle); }).catch(function () {});
    }
    load();
    setInterval(load, 5000);
    setInterval(function () {
      var t = root.querySelector("[data-ov-timer]");
      if (t) t.textContent = countdown(t.getAttribute("data-ends"));
    }, 1000);
  }

  /* ---------------- store alerts ---------------- */

  function alerts() {
    var seen = {};
    var queue = [];
    var busy = false;
    var first = true;

    function play() {
      if (busy || !queue.length) return;
      busy = true;
      var a = queue.shift();
      var pic = C.storeImages[a.itemImage] || a.itemImage;
      root.innerHTML =
        '<section class="ov-panel ov-alert ov-alert--' + esc(a.tier || "blue") + '">' +
          '<img class="ov-alert__avatar" src="' + esc(a.avatar || "/assets/shared/rekoj-logo.webp") + '" alt="" />' +
          '<div class="ov-alert__main"><p class="ov-alert__who"><b>' + esc(a.username) + "</b> redeemed</p>" +
            '<p class="ov-alert__item">' + esc(a.itemName) + '</p><p class="ov-alert__cost"><img src="/assets/store/coin.webp" alt="" width="16" height="16" />' +
            R.money(a.cost, 0) + " points</p></div>" +
          '<img class="ov-alert__pic" src="' + esc(pic) + '" alt="" />' +
        "</section>";
      setTimeout(function () {
        var el = root.querySelector(".ov-alert");
        if (el) el.classList.add("is-leaving");
        setTimeout(function () { root.innerHTML = ""; busy = false; play(); }, 500);
      }, 6500);
    }

    function load() {
      R.api("/api/overlay/alerts").then(function (d) {
        var fresh = (d.alerts || []).filter(function (a) { return !seen[a.id]; }).reverse();
        fresh.forEach(function (a) { seen[a.id] = true; });
        // Orders from before the overlay was opened don't pop up
        if (!first) { queue = queue.concat(fresh); play(); }
        first = false;
      }).catch(function () {});
    }

    if (params.get("demo")) {
      var demo = { id: "demo", username: "Viewer123", itemName: "Wanted $40 Bonus Buy", itemImage: "bonusbuy", tier: "blue", cost: 25000 };
      var loop = function () { queue.push(demo); play(); };
      loop();
      setInterval(loop, 9000);
      return;
    }
    load();
    setInterval(load, 5000);
  }

  if (kind === "leaderboard") leaderboard();
  else if (kind === "raffle") raffle();
  else if (kind === "alerts") alerts();
  else root.innerHTML = '<p class="ov-panel ov-unknown">Unknown overlay. Use /overlay/leaderboard, /overlay/raffle or /overlay/alerts.</p>';
})();
