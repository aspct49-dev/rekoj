/*
 * Wager Raffles on the Raffles page (server/wagerraffles.js): everyone who
 * wagers under the code during the period is entered automatically.
 *
 * raffles.js shows them as normal raffle cards (Active Raffles while they
 * count or draw, Past Raffles once finished) using cardHTML / pastHTML here.
 * Clicking one opens the details in a dialog: how it works, the viewer's own
 * tickets, the winners, every entry with its odds, and once finished, a
 * Verify button that re-runs every draw in the browser from the revealed
 * seed. /raffles#wager-<id> opens one directly.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var C = window.REKOJ_CONTENT || {};
  var esc = R.esc;
  var data = { list: [], signedIn: false };
  var dialog = null, openId = null, showAll = false;

  var usd = function (n, d) { return "$" + R.money(n, d == null ? (n % 1 ? 2 : 0) : d); };
  var pct = function (x) { return (x * 100).toFixed(x >= 0.1 ? 1 : 2) + "%"; };
  var plural = function (n, one, many) { return R.money(n, 0) + " " + (n === 1 ? one : many); };
  var day = function (ms) {
    return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  };
  var thumb = function (t) { return t ? (C.raffleThumbs && C.raffleThumbs[t]) || t : null; };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

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

  /* ---------------- cards (the raffle card design) ---------------- */

  function picture(w, cls) {
    var img = thumb(w.thumb);
    return img ? '<img src="' + esc(img) + '" alt="" loading="lazy" />'
      : '<div class="' + cls + '"><span>Wager raffle</span><b>' + usd(w.prizePool, 0) + "</b><small>" + esc(w.casinoName) + "</small></div>";
  }

  /** Active card: same layout as a join raffle; the button opens the details. */
  function cardHTML(w) {
    var timer = w.state === "counting" ? '<span data-ends="' + new Date(w.end).toISOString() + '">' + (R.shortCountdown(new Date(w.end).toISOString()) || "ENDED") + "</span>"
      : w.state === "upcoming" ? "<span>STARTS " + esc(new Date(w.start).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase()) + "</span>"
      : "<span>" + (w.state === "locked" ? "DRAWING NOW" : "DRAWING SOON") + "</span>";
    var label = w.mine ? "YOUR TICKETS: " + R.money(w.mine.tickets, 0) : "VIEW · AUTO ENTRY";
    return (
      '<article class="raffle raffle--wager' + (w.mine ? " has-tickets" : "") + '" data-wr-open="' + esc(w.id) + '" tabindex="-1">' +
        '<div class="raffle__thumb">' + picture(w, "raffle__auto") +
          '<span class="raffle__timer"><img src="/assets/raffles/icon-clock.svg" alt="" width="12" height="12" />' + timer + "</span>" +
          '<span class="raffle__rule"><b>' + esc(w.casinoName.toUpperCase()) + "</b>" + usd(w.unit, 0) + " = 1 TICKET</span>" +
        "</div>" +
        '<h2 class="raffle__title">' + esc(w.title) + "<br />" + usd(w.prizePool, 0) + " Prize Pool</h2>" +
        '<p class="raffle__stat raffle__stat--winners"><img src="/assets/raffles/icon-winners.svg" alt="" width="13" height="13" />' + plural(w.drawsTotal, "Winner", "Winners") + "</p>" +
        '<p class="raffle__stat raffle__stat--entries"><img src="/assets/raffles/icon-entries.svg" alt="" width="12" height="13" />' + plural(w.entries.length, "Entry", "Entries") + "</p>" +
        '<button class="raffle__join" type="button" data-wr-open="' + esc(w.id) + '">' + label + "</button>" +
      "</article>"
    );
  }

  /** Past card: same layout as a finished join raffle. */
  function pastHTML(w) {
    var d = new Date(w.completedAt || w.end);
    return (
      '<article class="past-raffle past-raffle--wager">' +
        '<div class="past-raffle__thumb">' + picture(w, "raffle__auto raffle__auto--sm") +
          '<span class="past-raffle__ended"><img src="/assets/raffles/icon-clock-sm.svg" alt="" width="11" height="11" />' +
            "<span>Ended " + MONTHS[d.getUTCMonth()] + " " + ordinal(d.getUTCDate()) + "</span></span>" +
        "</div>" +
        '<div class="past-raffle__info">' +
          '<h3 class="past-raffle__title">' + esc(w.title) + "<br />" + usd(w.prizePool, 0) + " Prize Pool</h3>" +
          '<p class="past-raffle__stat past-raffle__stat--winners"><img src="/assets/raffles/icon-winners-sm.svg" alt="" width="11" height="11" />' + plural(w.drawsTotal, "Winner", "Winners") + "</p>" +
          '<p class="past-raffle__stat past-raffle__stat--entries"><img src="/assets/raffles/icon-entries-sm.svg" alt="" width="11" height="12" />' + plural(w.entries.length, "Entry", "Entries") + "</p>" +
          '<button class="past-raffle__view" type="button" data-wr-open="' + esc(w.id) + '">VIEW</button>' +
        "</div>" +
      "</article>"
    );
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
  /** Re-run every recorded draw; resolves to [{ n, ok }] */
  function verify(r) {
    var out = [];
    var step = function (k) {
      if (k >= r.draws.length) return Promise.resolve(out);
      var wins = {}, gone = {};
      r.draws.slice(0, k).forEach(function (d) { if (d.rerolledAt) gone[d.index] = true; else wins[d.index] = (wins[d.index] || 0) + 1; });
      var pool = r.entries.map(function (e, i) { return { e: e, i: i }; }).filter(function (x) { return !gone[x.i] && (wins[x.i] || 0) < r.maxWins; });
      var total = pool.reduce(function (s, x) { return s + x.e.tickets; }, 0);
      return hmacFloat(r.seed, r.id + ":" + k + ":0").then(function (f) {
        var ticket = Math.min(total - 1, Math.floor(f * total)), at = 0, index = -1;
        for (var j = 0; j < pool.length; j++) { at += pool[j].e.tickets; if (ticket < at) { index = pool[j].i; break; } }
        var d = r.draws[k];
        out.push({ n: k, ok: index === d.index && ticket === d.ticket && total === d.pool });
        return step(k + 1);
      });
    };
    return step(0);
  }

  /* ---------------- details (in the dialog) ---------------- */

  function mineHTML(r) {
    if (!data.signedIn) {
      return '<p class="wr-you__text">Log in to see your tickets and odds.</p><a class="btn btn--dark wr-you__btn" href="' + R.loginUrl("/raffles#wager-" + r.id) + '">Log in with Kick</a>';
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
        return '<li class="' + (d.rerolledAt ? "is-rerolled" : "") + '"><span class="wr-winners__n">' + (d.n + 1) + "</span><b>" + esc(d.name) + "</b>" +
          (you ? ' <span class="pill pill--done">You</span>' : "") +
          '<span class="wr-winners__prize">' + (d.rerolledAt ? "rerolled" : usd(d.prize)) + "</span></li>";
      }).join("") + "</ol></section>";
  }

  function entriesHTML(r) {
    if (!r.entries.length) {
      return '<p class="wr-empty">' + (r.state === "upcoming" ? "Tickets start counting " + day(r.start) + "." : "No tickets yet. The first " + usd(r.unit) + " wagered under " + esc(R.config.code) + " gets the first one.") + "</p>";
    }
    var rows = r.entries.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) { return b.e.tickets - a.e.tickets || a.i - b.i; });
    var shown = showAll ? rows : rows.slice(0, 25);
    return '<div class="wr-table" role="table" aria-label="Entries"><div class="wr-table__row wr-table__head" role="row"><span role="columnheader">#</span><span role="columnheader">Player</span><span role="columnheader">Wagered</span><span role="columnheader">Tickets</span><span role="columnheader">Odds</span></div>' +
      shown.map(function (x, k) {
        var you = r.mine && x.i === r.mine.index;
        return '<div class="wr-table__row' + (you ? " is-you" : "") + '" role="row"><span role="cell">' + (k + 1) + '</span><span role="cell">' + esc(x.e.name) + (you ? ' <span class="pill pill--done">You</span>' : "") + "</span>" +
          '<span role="cell">' + usd(x.e.amount, 0) + '</span><span role="cell"><b>' + R.money(x.e.tickets, 0) + '</b></span><span role="cell">' + pct(x.e.odds) + "</span></div>";
      }).join("") + "</div>" +
      (rows.length > 25 ? '<button class="btn btn--dark wr-more" type="button" data-wr-more>' + (showAll ? "Show top 25" : "Show all " + rows.length) + "</button>" : "");
  }

  function fairHTML(r) {
    if (!r.seedHash) return '<p class="wr-muted">When counting ends, the tickets are frozen and the draw is locked in with a secret seed. Its fingerprint (hash) is published here before any draw, and the seed is revealed at the end so anyone can re-run every draw.</p>';
    return '<p class="wr-muted">Tickets frozen ' + day(r.lockedAt) + ". Draw k picks ticket ⌊HMAC-SHA256(seed, \"" + esc(r.id) + ':k:0") × tickets in play⌋.</p>' +
      '<p class="wr-hash"><span>Seed hash</span><code>' + esc(r.seedHash) + "</code></p>" +
      (r.seed ? '<p class="wr-hash"><span>Seed</span><code>' + esc(r.seed) + '</code></p><button class="btn btn--dark wr-verify" type="button" data-wr-verify>Verify the draws</button><p class="wr-verify__out" data-wr-verify-out role="status"></p>'
        : '<p class="wr-muted">The seed is revealed when the raffle is finished.</p>');
  }

  function detailHTML(r) {
    var chip = CHIP[r.state] || ["", "muted"];
    var img = thumb(r.thumb);
    return '<article class="wr">' +
      '<header class="wr-head">' +
        (img ? '<img class="wr-head__thumb" src="' + esc(img) + '" alt="" />' : '<span class="wr-head__badge" aria-hidden="true">' + esc(r.casinoName.toUpperCase()) + "</span>") +
        '<div class="wr-head__main">' +
          '<h2 class="wr-head__title" id="wrTitle">' + esc(r.title) + ' <span class="pill pill--' + chip[1] + '">' + chip[0] + "</span></h2>" +
          '<p class="wr-head__prize"><b>' + usd(r.prizePool) + "</b> prize pool · " + plural(r.drawsTotal, "draw", "draws") + " of " + usd(r.prizePerDraw) +
            " · up to " + plural(r.maxWins, "win", "wins") + " each</p>" +
          '<p class="wr-head__when">' + (r.state === "counting" ? "Tickets count until " + day(r.end) + ' · <b class="wr-timer" data-wr-ends="' + r.end + '">' + countdown(r.end) + "</b>"
            : r.state === "upcoming" ? "Tickets start counting " + day(r.start)
            : "Counted " + day(r.start) + " → " + day(r.end)) + "</p>" +
        "</div>" +
        '<button class="wr-close" type="button" data-wr-close aria-label="Close">×</button>' +
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
        '<section class="wr-card wr-entries"><h3 class="wr-card__title">Entries <span class="wr-muted">' + plural(r.entries.length, "player", "players") + " · " + plural(r.totalTickets, "ticket", "tickets") + "</span></h3>" +
          (r.error ? '<p class="wr-muted">' + esc(r.error) + "</p>" : "") + entriesHTML(r) + "</section>" +
      "</div>" +
    "</article>";
  }

  function find(id) { return data.list.filter(function (x) { return x.id === id; })[0]; }

  function paint() {
    var r = find(openId);
    if (!dialog || !r) return;
    var keepScroll = dialog.scrollTop;
    dialog.innerHTML = detailHTML(r);
    dialog.scrollTop = keepScroll;
    dialog.querySelector("[data-wr-close]").addEventListener("click", function () { dialog.close(); });
    var more = dialog.querySelector("[data-wr-more]");
    if (more) more.addEventListener("click", function () { showAll = !showAll; paint(); });
    var v = dialog.querySelector("[data-wr-verify]");
    if (v) v.addEventListener("click", function () {
      var out = dialog.querySelector("[data-wr-verify-out]");
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

  function open(id) {
    if (!find(id)) return;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "dialog dialog--wr";
      dialog.setAttribute("aria-labelledby", "wrTitle");
      dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
      dialog.addEventListener("close", function () {
        openId = null;
        if (/^#wager-/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      });
      document.body.appendChild(dialog);
    }
    openId = id;
    showAll = false;
    paint();
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    history.replaceState(null, "", "#wager-" + id);
  }

  /** raffles.js hands over each refresh; an open dialog follows along. */
  function setData(list, signedIn) {
    data.list = list || [];
    data.signedIn = !!signedIn;
    if (openId) paint();
    var m = /^#wager-([0-9a-f-]{36})$/.exec(location.hash);
    if (m && !openId && find(m[1])) open(m[1]);
  }

  setInterval(function () {
    var t = dialog && dialog.open && dialog.querySelector("[data-wr-ends]");
    if (t) t.textContent = countdown(Number(t.getAttribute("data-wr-ends")));
  }, 1000);

  window.RekojWagerRaffle = { cardHTML: cardHTML, pastHTML: pastHTML, open: open, setData: setData };
})();
