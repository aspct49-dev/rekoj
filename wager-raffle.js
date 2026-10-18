/*
 * Wager Raffle on the Raffles page: everyone who wagers under the code during
 * the period is entered automatically (server/wagerraffles.js). Shows the
 * countdown, how tickets work, the viewer's own tickets, the winners, every
 * entry with its odds, and once finished, a Verify button that re-runs every
 * draw in the browser from the revealed seed.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var C = window.REKOJ_CONTENT || {};
  var box = document.getElementById("wagerRaffle");
  var section = document.getElementById("wagerRaffleSection");
  if (!box || !section) return;

  var state = { list: [], pick: null, signedIn: false, showAll: false };
  var esc = R.esc;
  var usd = function (n, d) { return "$" + R.money(n, d == null ? (n % 1 ? 2 : 0) : d); };
  var pct = function (x) { return (x * 100).toFixed(x >= 0.1 ? 1 : 2) + "%"; };
  var day = function (ms) {
    return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  };
  var thumb = function (t) { return t ? (C.raffleThumbs && C.raffleThumbs[t]) || t : null; };

  var CHIP = {
    counting: ["Counting tickets", "pending"],
    upcoming: ["Starts soon", "muted"],
    ended: ["Counting finished · drawing soon", "refunded"],
    locked: ["Drawing", "pending"],
    complete: ["Finished", "done"],
  };

  function countdown(ms) {
    var s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
    return R.pad(Math.floor(s / 86400)) + "D " + R.pad(Math.floor((s % 86400) / 3600)) + "H " + R.pad(Math.floor((s % 3600) / 60)) + "M " + R.pad(s % 60) + "S";
  }

  /* ---------------- verify (same maths as the server) ---------------- */

  function hmacFloat(seed, msg) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(seed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (key) { return crypto.subtle.sign("HMAC", key, enc.encode(msg)); })
      .then(function (buf) { var b = new Uint8Array(buf); return b[0] / 256 + b[1] / 65536 + b[2] / 16777216 + b[3] / 4294967296; });
  }
  function sha256Hex(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    });
  }
  /** Re-run every recorded draw; resolves to a list of { n, ok, index, ticket } */
  function verify(r) {
    var out = [];
    var step = function (k) {
      if (k >= r.draws.length) return Promise.resolve(out);
      var prev = r.draws.slice(0, k);
      var wins = {}, gone = {};
      prev.forEach(function (d) { if (d.rerolledAt) gone[d.index] = true; else wins[d.index] = (wins[d.index] || 0) + 1; });
      var pool = r.entries.map(function (e, i) { return { e: e, i: i }; }).filter(function (x) { return !gone[x.i] && (wins[x.i] || 0) < r.maxWins; });
      var total = pool.reduce(function (s, x) { return s + x.e.tickets; }, 0);
      return hmacFloat(r.seed, r.id + ":" + k + ":0").then(function (f) {
        var ticket = Math.min(total - 1, Math.floor(f * total)), at = 0, index = -1;
        for (var j = 0; j < pool.length; j++) { at += pool[j].e.tickets; if (ticket < at) { index = pool[j].i; break; } }
        var d = r.draws[k];
        out.push({ n: k, ok: index === d.index && ticket === d.ticket && total === d.pool, index: index, ticket: ticket });
        return step(k + 1);
      });
    };
    return step(0);
  }

  /* ---------------- render ---------------- */

  function mineHTML(r) {
    if (!state.signedIn) {
      return '<p class="wr-you__text">Log in to see your tickets and odds.</p><a class="btn btn--dark wr-you__btn" href="' + R.loginUrl("/raffles#wager-raffle") + '">Log in with Kick</a>';
    }
    if (!r.mine) {
      return '<p class="wr-you__text">No tickets yet. Every ' + usd(r.unit) + " you wager on " + esc(r.casinoName) + " under code <b>" + esc(R.config.code) +
        '</b> is a ticket, automatically.</p><p class="wr-you__hint">Already playing? <a href="/profile#links">Link your ' + esc(r.casinoName) + " username</a> so we can show you yours.</p>";
    }
    var m = r.mine;
    return '<div class="wr-you__stats"><span><b>' + R.money(m.tickets, 0) + "</b><small>ticket" + (m.tickets === 1 ? "" : "s") + "</small></span>" +
      "<span><b>" + pct(m.odds) + "</b><small>chance per draw</small></span>" +
      "<span><b>" + usd(m.amount, 0) + "</b><small>wagered</small></span></div>" +
      (r.status !== "open" && m.wins ? '<p class="wr-you__won">You won ' + m.wins + " prize" + (m.wins === 1 ? "" : "s") + "! We'll be in touch.</p>" : "");
  }

  function drawsHTML(r) {
    if (!r.draws.length) return "";
    var won = r.draws.filter(function (d) { return !d.rerolledAt; }).length;
    return '<section class="wr-card wr-winners"><h3 class="wr-card__title">Winners <span class="wr-muted">' + won + " of " + r.drawsTotal + "</span></h3><ol>" +
      r.draws.map(function (d) {
        var you = r.mine && d.index === r.mine.index;
        return '<li class="' + (d.rerolledAt ? "is-rerolled" : "") + '"><span class="wr-winners__n">' + (d.n + 1) + '</span><b>' + esc(d.name) + "</b>" +
          (you ? ' <span class="pill pill--done">You</span>' : "") +
          '<span class="wr-winners__prize">' + (d.rerolledAt ? "rerolled" : usd(d.prize)) + "</span></li>";
      }).join("") + "</ol></section>";
  }

  function entriesHTML(r) {
    if (!r.entries.length) {
      return '<p class="wr-empty">' + (r.state === "upcoming" ? "Tickets start counting " + day(r.start) + "." : "No tickets yet. The first " + usd(r.unit) + " wagered under " + esc(R.config.code) + " gets the first one.") + "</p>";
    }
    var rows = r.entries.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) { return b.e.tickets - a.e.tickets || a.i - b.i; });
    var shown = state.showAll ? rows : rows.slice(0, 25);
    return '<div class="wr-table" role="table" aria-label="Entries"><div class="wr-table__row wr-table__head" role="row"><span role="columnheader">#</span><span role="columnheader">Player</span><span role="columnheader">Wagered</span><span role="columnheader">Tickets</span><span role="columnheader">Odds</span></div>' +
      shown.map(function (x, k) {
        var you = r.mine && x.i === r.mine.index;
        return '<div class="wr-table__row' + (you ? " is-you" : "") + '" role="row"><span role="cell">' + (k + 1) + '</span><span role="cell">' + esc(x.e.name) + (you ? ' <span class="pill pill--done">You</span>' : "") + "</span>" +
          '<span role="cell">' + usd(x.e.amount, 0) + '</span><span role="cell"><b>' + R.money(x.e.tickets, 0) + '</b></span><span role="cell">' + pct(x.e.odds) + "</span></div>";
      }).join("") + "</div>" +
      (rows.length > 25 ? '<button class="btn btn--dark wr-more" type="button" data-wr-more>' + (state.showAll ? "Show top 25" : "Show all " + rows.length) + "</button>" : "");
  }

  function fairHTML(r) {
    if (!r.seedHash) return '<p class="wr-muted">When counting ends, the tickets are frozen and the draw is locked in with a secret seed. Its fingerprint (hash) is published here before any draw, and the seed is revealed at the end so anyone can re-run every draw.</p>';
    return '<p class="wr-muted">Tickets frozen ' + day(r.lockedAt) + ". Draw k picks ticket ⌊HMAC-SHA256(seed, \"" + esc(r.id) + ':k:0") × tickets in play⌋.</p>' +
      '<p class="wr-hash"><span>Seed hash</span><code>' + esc(r.seedHash) + "</code></p>" +
      (r.seed ? '<p class="wr-hash"><span>Seed</span><code>' + esc(r.seed) + '</code></p><button class="btn btn--dark wr-verify" type="button" data-wr-verify>Verify the draws</button><p class="wr-verify__out" data-wr-verify-out role="status"></p>'
        : '<p class="wr-muted">The seed is revealed when the raffle is finished.</p>');
  }

  function render() {
    var r = state.list.filter(function (x) { return x.id === state.pick; })[0] || state.list[0];
    if (!r) { section.hidden = true; return; }
    section.hidden = false;
    var chip = CHIP[r.state] || ["", "muted"];
    var img = thumb(r.thumb);
    var others = state.list.filter(function (x) { return x.id !== r.id; });
    box.innerHTML =
      '<article class="wr">' +
        '<header class="wr-head">' +
          (img ? '<img class="wr-head__thumb" src="' + esc(img) + '" alt="" />' : '<span class="wr-head__badge" aria-hidden="true">' + esc(r.casinoName.toUpperCase()) + "</span>") +
          '<div class="wr-head__main">' +
            '<h3 class="wr-head__title">' + esc(r.title) + ' <span class="pill pill--' + chip[1] + '">' + chip[0] + "</span></h3>" +
            '<p class="wr-head__prize"><b>' + usd(r.prizePool) + "</b> prize pool · " + r.drawsTotal + " draw" + (r.drawsTotal === 1 ? "" : "s") + " of " + usd(r.prizePerDraw) +
              " · up to " + r.maxWins + " win" + (r.maxWins === 1 ? "" : "s") + " each</p>" +
            '<p class="wr-head__when">' + (r.state === "counting" ? 'Tickets count until ' + day(r.end) + ' · <b class="wr-timer" data-wr-ends="' + r.end + '">' + countdown(r.end) + "</b>"
              : r.state === "upcoming" ? "Tickets start counting " + day(r.start)
              : "Counted " + day(r.start) + " → " + day(r.end)) + "</p>" +
          "</div>" +
        "</header>" +
        '<div class="wr-how">' +
          '<div class="wr-how__item"><b>Wager under ' + esc(R.config.code) + "</b><span>On " + esc(r.casinoName) + ", during the counting period.</span></div>" +
          '<div class="wr-how__item"><b>' + usd(r.unit) + " = 1 ticket</b><span>You're entered automatically. Nothing to join.</span></div>" +
          '<div class="wr-how__item"><b>More tickets, better odds</b><span>Each draw picks one ticket, so your chance is your share of them.</span></div>' +
        "</div>" +
        '<div class="wr-grid">' +
          '<div class="wr-side">' +
            '<section class="wr-card wr-you"><h3 class="wr-card__title">Your tickets</h3>' + mineHTML(r) + "</section>" +
            drawsHTML(r) +
            '<section class="wr-card wr-fair"><h3 class="wr-card__title">Provably fair</h3>' + fairHTML(r) + "</section>" +
          "</div>" +
          '<section class="wr-card wr-entries"><h3 class="wr-card__title">Entries <span class="wr-muted">' + R.money(r.entries.length, 0) + " players · " + R.money(r.totalTickets, 0) + " tickets</span></h3>" +
            (r.error ? '<p class="wr-muted">' + esc(r.error) + "</p>" : "") + entriesHTML(r) + "</section>" +
        "</div>" +
        (others.length ? '<div class="wr-others"><span class="wr-muted">Other wager raffles:</span>' + others.map(function (o) {
          return '<button class="wr-others__btn" type="button" data-wr-pick="' + esc(o.id) + '">' + esc(o.title) + " · " + (CHIP[o.state] || [""])[0] + "</button>";
        }).join("") + "</div>" : "") +
      "</article>";

    var more = box.querySelector("[data-wr-more]");
    if (more) more.addEventListener("click", function () { state.showAll = !state.showAll; render(); });
    Array.prototype.forEach.call(box.querySelectorAll("[data-wr-pick]"), function (b) {
      b.addEventListener("click", function () { state.pick = b.getAttribute("data-wr-pick"); state.showAll = false; render(); });
    });
    var v = box.querySelector("[data-wr-verify]");
    if (v) v.addEventListener("click", function () {
      var out = box.querySelector("[data-wr-verify-out]");
      v.disabled = true;
      out.textContent = "Checking…";
      sha256Hex(r.seed).then(function (h) {
        if (h !== r.seedHash) { out.textContent = "✗ The revealed seed doesn't match the published hash."; out.className = "wr-verify__out is-bad"; return; }
        return verify(r).then(function (res) {
          var badOnes = res.filter(function (x) { return !x.ok; });
          out.className = "wr-verify__out " + (badOnes.length ? "is-bad" : "is-ok");
          out.textContent = badOnes.length ? "✗ Draw " + badOnes.map(function (x) { return x.n + 1; }).join(", ") + " didn't match."
            : "✓ Seed matches its hash, and all " + res.length + " draw" + (res.length === 1 ? "" : "s") + " re-run to the same tickets and winners.";
        });
      }).catch(function () { out.textContent = "This browser can't run the check."; }).then(function () { v.disabled = false; });
    });
  }

  function load() {
    return R.api("/api/wager-raffles").then(function (d) {
      state.list = d.raffles || [];
      state.signedIn = !!d.signedIn;
      render();
    }).catch(function () { /* keep what's shown */ });
  }

  load();
  setInterval(function () {
    var t = box.querySelector("[data-wr-ends]");
    if (t) t.textContent = countdown(Number(t.getAttribute("data-wr-ends")));
  }, 1000);
  setInterval(load, 60000);
})();
