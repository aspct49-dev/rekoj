/*
 * Raffles: active raffles (live countdowns, search, sort by prize value,
 * joining) and the Past Raffles carousel with each draw's winners. Raffles
 * come from the API (managed in /admin), with content.js as the fallback.
 *
 * They're wager raffles: a viewer links their casino username on /profile
 * (an admin approves it), joins, and gets tickets for what they wager under
 * the code during the raffle's window.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var C = window.REKOJ_CONTENT;

  var grid = document.getElementById("raffleGrid");
  var empty = document.getElementById("rafflesEmpty");
  var search = document.getElementById("rafflesSearch");
  var sort = document.getElementById("rafflesSort");
  var track = document.getElementById("pastTrack");
  var rail = document.getElementById("pastRail");
  var prev = document.querySelector(".past__nav--prev");
  var next = document.querySelector(".past__nav--next");
  // dir: null shows the saved order (as in the design).
  var state = { query: "", dir: null, active: [], past: [], live: false, mine: null, wager: [] };
  // Wager raffles (automatic entry) are drawn by wager-raffle.js in the same card design
  var WR = function () { return window.RekojWagerRaffle; };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function endedLabel(iso) {
    var d = new Date(iso);
    return "Ended " + MONTHS[d.getUTCMonth()] + " " + ordinal(d.getUTCDate());
  }

  function plural(n, one, many) { return R.money(n, 0) + " " + (n === 1 ? one : many); }
  function dollars(n) { return "$" + R.money(n, n % 1 ? 2 : 0); }
  function stamp(iso) {
    return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  }

  // "$100 = 1 TICKET" on the card
  function ruleShort(r) {
    return dollars(r.perDollars) + " = " + plural(r.ticketsPer, "TICKET", "TICKETS");
  }

  // The full rules, for the join dialog
  function rulesHTML(r) {
    var bits = ["Every <b>" + dollars(r.perDollars) + "</b> you wager on <b>" + R.esc(r.casinoName) + "</b> under code <b>" +
      R.esc(R.config.code) + "</b> gives you <b>" + plural(r.ticketsPer, "ticket", "tickets") + "</b>."];
    if (r.minWager) bits.push("You need at least <b>" + dollars(r.minWager) + "</b> wagered to get any tickets.");
    if (r.maxTickets) bits.push("Up to <b>" + plural(r.maxTickets, "ticket", "tickets") + "</b> each.");
    bits.push("Wagers count from " + stamp(r.wagerFrom) + " until the raffle ends (" + stamp(r.endsAt) + ")" +
      (r.casino === "razed" ? "; Razed reports whole days." : "."));
    bits.push("More tickets, better odds: winners are drawn at random, weighted by tickets.");
    return "<p>" + bits.join(" ") + "</p>";
  }
  function myTickets(r) { return state.mine && state.mine.tickets && state.mine.tickets[r.id]; }
  function titleHTML(r) { var s = R.raffleSub(r); return R.esc(r.game) + (s ? "<br />" + R.esc(s) : ""); }
  function oneLine(r) { return R.raffleSub(r) ? "" : " is-one-line"; }
  function thumbSrc(t) { return C.raffleThumbs[t] || t; }

  // Built-in raffles while the API can't be reached
  function fallback() {
    var mk = function (r, i, past) {
      return {
        id: "fallback-" + (past ? "p" : "a") + i, game: r.game, prize: r.prize, value: r.value, winners: r.winners,
        thumb: r.thumb, endsAt: past ? r.endedAt : r.endsAt, entries: r.entries || 0,
        entered: false, winnersList: [], state: past ? "drawn" : "open", drawnAt: past ? Date.parse(r.endedAt) : null,
        casino: "razed", casinoName: "Razed", perDollars: 100, ticketsPer: 1, minWager: 0, maxTickets: 0, wagerFrom: new Date().toISOString(),
      };
    };
    state.active = C.raffles.active.map(function (r, i) { return mk(r, i, false); });
    state.past = C.raffles.past.map(function (r, i) { return mk(r, i, true); });
  }

  function joinLabel(r) {
    var t = myTickets(r);
    if (r.entered) return t && t.tickets !== undefined ? "JOINED · " + plural(t.tickets, "TICKET", "TICKETS") : "JOINED ✓";
    return "JOIN NOW";
  }

  function activeHTML(r) {
    return (
      '<article class="raffle' + (r.entered ? " is-entered" : "") + '">' +
        '<div class="raffle__thumb">' +
          '<img src="' + R.esc(thumbSrc(r.thumb)) + '" alt="" loading="lazy" />' +
          '<span class="raffle__timer"><img src="/assets/raffles/icon-clock.svg" alt="" width="12" height="12" />' +
            '<span data-ends="' + R.esc(r.endsAt) + '">' + (R.shortCountdown(r.endsAt) || "ENDED") + "</span></span>" +
          '<span class="raffle__rule"><b>' + R.esc(r.casinoName.toUpperCase()) + "</b>" + ruleShort(r) + "</span>" +
        "</div>" +
        '<h2 class="raffle__title' + oneLine(r) + '">' + titleHTML(r) + "</h2>" +
        '<p class="raffle__stat raffle__stat--winners"><img src="/assets/raffles/icon-winners.svg" alt="" width="13" height="13" />' +
          plural(r.winners, "Winner", "Winners") + "</p>" +
        '<p class="raffle__stat raffle__stat--entries"><img src="/assets/raffles/icon-entries.svg" alt="" width="12" height="13" />' +
          plural(r.entries, "Entry", "Entries") + "</p>" +
        '<button class="raffle__join" type="button" data-join="' + R.esc(r.id) + '"' + (r.entered ? " disabled" : "") + ">" +
          joinLabel(r) + "</button>" +
      "</article>"
    );
  }

  function pastHTML(r) {
    return (
      '<article class="past-raffle">' +
        '<div class="past-raffle__thumb">' +
          '<img src="' + R.esc(thumbSrc(r.thumb)) + '" alt="" loading="lazy" />' +
          '<span class="past-raffle__ended"><img src="/assets/raffles/icon-clock-sm.svg" alt="" width="11" height="11" />' +
            "<span>" + endedLabel(r.drawnAt ? new Date(r.drawnAt).toISOString() : r.endsAt) + "</span></span>" +
        "</div>" +
        '<div class="past-raffle__info">' +
          '<h3 class="past-raffle__title' + oneLine(r) + '">' + titleHTML(r) + "</h3>" +
          '<p class="past-raffle__stat past-raffle__stat--winners"><img src="/assets/raffles/icon-winners-sm.svg" alt="" width="11" height="11" />' +
            plural(r.winners, "Winner", "Winners") + "</p>" +
          '<p class="past-raffle__stat past-raffle__stat--entries"><img src="/assets/raffles/icon-entries-sm.svg" alt="" width="11" height="12" />' +
            plural(r.entries, "Entry", "Entries") + "</p>" +
          '<button class="past-raffle__view" type="button" data-view="' + R.esc(r.id) + '">VIEW</button>' +
        "</div>" +
      "</article>"
    );
  }

  function renderActive() {
    var q = state.query.trim().toLowerCase();
    // Wager raffles first (they're for everyone), then the join raffles
    var items = (WR() ? state.wager.filter(function (w) { return w.state !== "complete"; }) : [])
      .map(function (w) { return { w: w, text: w.title + " " + w.casinoName, value: w.prizePool }; })
      .concat(state.active.map(function (r) { return { r: r, text: r.game + " " + r.prize, value: r.value }; }));
    var list = items
      .map(function (x, i) { x.i = i; return x; })
      .filter(function (x) { return !q || x.text.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) {
        if (!state.dir) return a.i - b.i;
        var d = state.dir === "asc" ? a.value - b.value : b.value - a.value;
        return d || a.i - b.i;
      });
    grid.innerHTML = list.map(function (x) { return x.w ? WR().cardHTML(x.w) : activeHTML(x.r); }).join("");
    empty.hidden = list.length > 0;
    if (!items.length) empty.textContent = "No raffles are running right now. Check back soon!";
    else empty.textContent = "No raffles match your search.";
  }

  function renderPast() {
    var when = function (x) { return x.w ? x.w.completedAt || x.w.end : x.r.drawnAt || Date.parse(x.r.endsAt); };
    var items = (WR() ? state.wager.filter(function (w) { return w.state === "complete"; }) : [])
      .map(function (w) { return { w: w }; })
      .concat(state.past.map(function (r) { return { r: r }; }))
      .sort(function (a, b) { return when(b) - when(a); });
    rail.innerHTML = items.map(function (x) { return x.w ? WR().pastHTML(x.w) : pastHTML(x.r); }).join("") ||
      '<p class="past__empty">Finished raffles and their winners will show here.</p>';
    updateNav();
  }

  function tickTimers() {
    Array.prototype.forEach.call(grid.querySelectorAll("[data-ends]"), function (el) {
      el.textContent = R.shortCountdown(el.getAttribute("data-ends")) || "ENDED";
    });
  }

  function load() {
    var wager = R.api("/api/wager-raffles").then(function (d) {
      state.wager = d.raffles || [];
      if (WR()) WR().setData(state.wager, d.signedIn);
    }).catch(function () { /* keep the last ones */ });
    return R.api("/api/raffles").then(function (data) {
      state.active = data.active || [];
      state.past = data.past || [];
      state.live = true;
      return loadMine();
    }).catch(function () {
      if (!state.live) fallback();
    }).then(function () { return wager; }).then(function () {
      renderActive();
      renderPast();
    });
  }

  // Linked accounts and tickets for whoever is signed in
  function loadMine() {
    return R.me().then(function (me) {
      if (!me.user) { state.mine = null; return; }
      return R.api("/api/raffles/mine").then(function (d) { state.mine = d; }, function () {});
    });
  }

  /* ---------------- joining ---------------- */

  function linkDialog(r, link) {
    var name = R.esc(r.casinoName);
    var pending = link && link.status === "pending";
    return R.confirm({
      title: pending ? "Waiting for approval" : "Link your " + r.casinoName + " account",
      html: pending
        ? "<p>You asked to link <b>" + R.esc(link.username) + "</b> on " + name + ". An admin will check it shortly; you can join raffles once it's approved.</p>"
        : "<p>This is a wager raffle: tickets come from what you wager on " + name + " under code <b>" + R.esc(R.config.code) +
          "</b>. Add your " + name + " username on your profile first; an admin approves it.</p>",
      confirm: pending ? "OK" : "Go to my profile",
      cancel: pending ? false : "Not now",
    }).then(function (ok) {
      if (ok && !pending) location.href = "/profile#links";
    });
  }

  grid.addEventListener("click", function (e) {
    var wr = e.target.closest("[data-wr-open]");
    if (wr && WR()) return WR().open(wr.getAttribute("data-wr-open"));
    var btn = e.target.closest("[data-join]");
    if (!btn || btn.disabled) return;
    var r = state.active.filter(function (x) { return x.id === btn.getAttribute("data-join"); })[0];
    if (!r) return;
    if (!state.live) return R.toast("Raffles are offline right now. Please try again shortly.");

    R.me().then(function (me) {
      if (!me.user) return R.login();
      var ready = state.mine ? Promise.resolve() : loadMine();
      return ready.then(function () {
        var link = state.mine && state.mine.links && state.mine.links[r.casino];
        if (!link || link.status !== "approved") return linkDialog(r, link);
        var t = myTickets(r);
        return R.confirm({
          title: "Join " + R.raffleLabel(r) + "?",
          html: rulesHTML(r) +
            '<p class="dialog__muted">Linked as <b>' + R.esc(link.username) + "</b> on " + R.esc(r.casinoName) + "." +
            (t && t.tickets !== undefined ? " So far: " + dollars(t.wagered) + " wagered = <b>" + plural(t.tickets, "ticket", "tickets") + "</b>." : "") + "</p>",
          confirm: "Join raffle",
        });
      }).then(function (ok) {
        if (!ok) return;
        btn.disabled = true;
        return R.api("/api/raffles/join", { id: r.id }).then(function (data) {
          Object.assign(r, data.raffle);
          if (data.mine && state.mine) { state.mine.tickets = state.mine.tickets || {}; state.mine.tickets[r.id] = data.mine; }
          renderActive();
          R.toast(data.mine ? "You're in with " + plural(data.mine.tickets, "ticket", "tickets") + " so far. Good luck!" : "You're in! Good luck.");
        }).catch(function (err) {
          btn.disabled = false;
          R.toast(R.esc(err.message));
          if (err.status === 401) R.login();
        });
      });
    });
  });

  /* ---------------- winners ---------------- */

  rail.addEventListener("click", function (e) {
    var wr = e.target.closest("[data-wr-open]");
    if (wr && WR()) return WR().open(wr.getAttribute("data-wr-open"));
    var btn = e.target.closest("[data-view]");
    if (!btn) return;
    var r = state.past.filter(function (x) { return x.id === btn.getAttribute("data-view"); })[0];
    if (!r) return;
    var winners = r.winnersList || [];
    R.confirm({
      title: R.raffleLabel(r),
      html: winners.length
        ? '<p class="dialog__muted">' + plural(r.entries, "entry", "entries") + (r.totalTickets ? " · " + plural(r.totalTickets, "ticket", "tickets") : "") + " · drawn " +
            new Date(r.drawnAt || r.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + "</p>" +
          '<ol class="dialog__winners">' + winners.map(function (w) { return "<li>" + R.esc(w) + "</li>"; }).join("") + "</ol>"
        : "<p>The winners for this raffle weren't recorded on the site.</p>",
      confirm: "Close",
      cancel: false,
    });
  });

  /* ---------------- past raffles carousel ---------------- */


  function step() {
    var card = rail.querySelector(".past-raffle");
    return card ? card.getBoundingClientRect().width + 8 : 345;
  }

  function updateNav() {
    var max = track.scrollWidth - track.clientWidth;
    prev.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft >= max - 1;
  }

  prev.addEventListener("click", function () { track.scrollBy({ left: -step(), behavior: "smooth" }); });
  next.addEventListener("click", function () { track.scrollBy({ left: step(), behavior: "smooth" }); });
  track.addEventListener("scroll", updateNav, { passive: true });
  window.addEventListener("resize", updateNav);

  /* ---------------- controls ---------------- */

  search.addEventListener("input", function () {
    state.query = search.value;
    renderActive();
  });

  sort.addEventListener("click", function () {
    state.dir = state.dir === "desc" ? "asc" : "desc";
    sort.classList.toggle("is-desc", state.dir === "desc");
    sort.querySelector("[data-sort-label]").textContent = state.dir === "asc" ? "Ascending" : "Descending";
    renderActive();
  });

  fallback();
  renderActive();
  renderPast();
  load();
  setInterval(tickTimers, 1000);
  // Entry counts and newly drawn raffles, every minute
  setInterval(load, 60000);
})();
