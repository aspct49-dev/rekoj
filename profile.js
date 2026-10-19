/*
 * Profile: the signed-in viewer's Kick account, Rekoj points (BotRix), linked
 * casino usernames (for wager raffles), store orders and raffle entries.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var C = window.REKOJ_CONTENT;
  var root = document.getElementById("profile");

  var STATUS = {
    pending: { label: "Pending", cls: "pending", text: "Waiting for RekoJ to send it." },
    fulfilled: { label: "Sent", cls: "done", text: "Sent to you." },
    rejected: { label: "Refunded", cls: "refunded", text: "Cancelled; your points were returned." },
  };

  var CASINOS = [["razed", "Razed"], ["razedio", "Razed.IO"]];
  var LINK = {
    pending: ["Waiting for approval", "pending"],
    approved: ["Linked", "done"],
    rejected: ["Not approved", "refunded"],
    unlinked: ["Removed", "muted"],
  };

  function date(ts) {
    return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function hours(minutes) { return R.money(Math.round((minutes || 0) / 60), 0); }

  function signedOut() {
    root.innerHTML =
      '<section class="profile-empty">' +
        '<img src="/assets/shared/rekoj-logo.webp" alt="" width="64" height="45" />' +
        '<h1 class="listing__title">Your RekoJ profile</h1>' +
        '<p class="listing__sub">Log in with Kick to see your Rekoj points, link your casino account for raffles, and track your orders.</p>' +
        '<a class="btn profile-empty__cta" href="' + R.loginUrl("/profile") + '">LOG IN WITH KICK</a>' +
      "</section>";
  }

  function stat(label, value, icon) {
    return '<div class="stat">' + (icon || "") + '<span class="stat__value">' + value + '</span><span class="stat__label">' + label + "</span></div>";
  }

  function orderRow(o) {
    var s = STATUS[o.status] || STATUS.pending;
    var img = C.storeImages[o.itemImage] || o.itemImage;
    return (
      '<li class="order">' +
        '<span class="order__pic order__pic--' + R.esc(o.tier) + '"><img src="' + R.esc(img) + '" alt="" loading="lazy" /></span>' +
        '<span class="order__main"><b>' + R.esc(o.itemName) + '</b><small>' + date(o.at) + " · " + s.text +
          (o.note ? " " + R.esc(o.note) : "") + "</small></span>" +
        '<span class="order__cost"><img src="/assets/store/coin.webp" alt="" width="15" height="15" />' + R.money(o.cost, 0) + "</span>" +
        '<span class="pill pill--' + s.cls + '">' + s.label + "</span>" +
      "</li>"
    );
  }

  function plural(n, one, many) { return R.money(n, 0) + " " + (n === 1 ? one : many); }

  function linkRow(c, link) {
    var id = c[0], name = c[1];
    var l = link && link.status ? link : null;
    var pill = l ? '<span class="pill pill--' + LINK[l.status][1] + '">' + LINK[l.status][0] + "</span>" : "";
    var form = '<form class="link__form" data-link="' + id + '">' +
        '<input name="username" type="text" autocomplete="off" spellcheck="false" maxlength="32" placeholder="Your ' + name + ' username" required ' +
          'value="' + R.esc(l && l.status !== "approved" && l.status !== "pending" ? l.username : "") + '" />' +
        '<button class="btn btn--dark link__btn" type="submit">' + (l ? "Try again" : "Link") + "</button>" +
      "</form>";
    var body;
    if (!l) body = '<small>Not linked yet. Enter it exactly as it shows on ' + name + "; an admin checks it's yours.</small>" + form;
    else if (l.status === "approved") body = "<small>Linked as <b>" + R.esc(l.username) + "</b>. Your " + name + " wagers under code " +
      R.esc(R.config.code) + " earn raffle tickets. Ask an admin if it needs changing.</small>";
    else if (l.status === "pending") body = "<small>You asked to link <b>" + R.esc(l.username) + "</b> on " + date(l.requestedAt) +
      ". An admin will check it soon.</small>" + '<button class="link__cancel" type="button" data-cancel-link="' + id + '">Cancel request</button>';
    else body = "<small>" + (l.status === "rejected" ? "<b>" + R.esc(l.username) + "</b> wasn't approved" : "An admin removed <b>" + R.esc(l.username) + "</b>") +
      (l.note ? ": " + R.esc(l.note) : ".") + "</small>" + form;
    return '<li class="link"><span class="link__casino">' + name + "</span>" + pill + '<div class="link__body">' + body + "</div></li>";
  }

  function raffleRow(r) {
    var thumb = C.raffleThumbs[r.thumb] || r.thumb;
    var label = r.state === "open" ? ["Entered", "pending"] : r.state === "drawn" ? (r.won ? ["Won!", "done"] : ["Not this time", "muted"]) : ["Drawing soon", "pending"];
    var t = r.mine && r.mine.tickets !== undefined ? " · " + plural(r.mine.tickets, "ticket", "tickets") + " ($" + R.money(r.mine.wagered || 0, 2) + " wagered)" : "";
    return (
      '<li class="order">' +
        '<span class="order__pic order__pic--raffle"><img src="' + R.esc(thumb) + '" alt="" loading="lazy" /></span>' +
        '<span class="order__main"><b>' + R.esc(R.raffleLabel(r)) + "</b><small>" +
          (r.state === "open" ? "Ends " + date(r.endsAt) : "Ended " + date(r.drawnAt || r.endsAt)) + " · " + R.money(r.entries, 0) + " entries" + t + "</small></span>" +
        '<span class="pill pill--' + label[1] + '">' + label[0] + "</span>" +
      "</li>"
    );
  }

  function render(me, activity) {
    var u = me.user;
    var p = me.points;
    var orders = activity.orders || [];
    var raffles = activity.raffles || [];
    var links = activity.links || {};
    root.innerHTML =
      '<section class="profile-card">' +
        '<img class="profile-card__avatar" src="' + R.esc(u.avatar || "/assets/shared/rekoj-logo.webp") + '" alt="" width="84" height="84" />' +
        '<div class="profile-card__who">' +
          '<h1 class="listing__title">' + R.esc(u.username) + "</h1>" +
          '<p class="listing__sub">Signed in with Kick' + (me.admin ? ' · <a class="accent" href="/admin">Admin panel</a>' : "") + "</p>" +
        "</div>" +
        '<div class="profile-card__stats">' +
          stat("Rekoj points", p ? R.money(p.points, 0) : "—", '<img src="/assets/store/coin.webp" alt="" width="22" height="22" />') +
          stat("Hours watched", p ? hours(p.watchtime) : "—") +
          stat("Orders", R.money(orders.length, 0)) +
        "</div>" +
        '<button class="btn btn--dark profile-card__logout" type="button" data-profile-logout>Log out</button>' +
      "</section>" +
      (p ? "" : '<p class="profile-note">' + (me.pointsError
        ? "Couldn't load your points from BotRix just now. Try again in a minute."
        : "BotRix hasn't seen you on RekoJ's channel yet. Watch a stream with chat open to start earning Rekoj points.") + "</p>") +

      '<section class="profile-section" id="earnings" hidden>' +
        '<div class="profile-section__head"><h2>Wager points</h2><a class="accent" href="/points-store#earn">How it works →</a></div>' +
        '<div class="earn-progress-list" data-earnings></div>' +
      "</section>" +

      '<section class="profile-section" id="links">' +
        '<div class="profile-section__head"><h2>Linked casino accounts</h2></div>' +
        '<p class="profile-section__intro">Raffles are wager raffles: link the username you play under with code <b class="accent">' + R.esc(R.config.code) +
          "</b> and your wagers earn tickets.</p>" +
        '<ul class="links">' + CASINOS.map(function (c) { return linkRow(c, links[c[0]]); }).join("") + "</ul>" +
      "</section>" +

      '<section class="profile-section">' +
        '<div class="profile-section__head"><h2>Store orders</h2><a class="accent" href="/points-store">Points Store →</a></div>' +
        (orders.length ? '<ul class="orders">' + orders.map(orderRow).join("") + "</ul>"
          : '<p class="profile-section__empty">No orders yet. Spend your points in the <a class="accent" href="/points-store">Points Store</a>.</p>') +
      "</section>" +

      '<section class="profile-section">' +
        '<div class="profile-section__head"><h2>Raffles</h2><a class="accent" href="/raffles">Raffles →</a></div>' +
        (raffles.length ? '<ul class="orders">' + raffles.map(raffleRow).join("") + "</ul>"
          : '<p class="profile-section__empty">You haven\'t entered any raffles yet. <a class="accent" href="/raffles">See what\'s running</a>.</p>') +
      "</section>";

    root.querySelector("[data-profile-logout]").addEventListener("click", function () {
      R.forgetAccount();
      R.api("/api/auth/logout", {}).finally(function () { location.href = "/"; });
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-link]"), function (f) {
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = f.querySelector("button");
        var errBox = f.parentNode.querySelector(".link__error");
        if (errBox) errBox.remove();
        btn.disabled = true;
        btn.textContent = "Checking…";
        R.api("/api/me/links", { casino: f.getAttribute("data-link"), username: f.username.value.trim() }).then(function () {
          R.toast("Found under code " + R.esc(R.config.code) + ". An admin will approve it soon.");
          load(me, "#links");
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Link";
          // Shown under the field: these explain what to fix
          var p = document.createElement("p");
          p.className = "link__error";
          p.setAttribute("role", "alert");
          p.textContent = err.message;
          f.insertAdjacentElement("afterend", p);
          f.username.focus();
        });
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-cancel-link]"), function (b) {
      b.addEventListener("click", function () {
        R.api("/api/me/links/cancel", { casino: b.getAttribute("data-cancel-link") }).then(function () {
          R.toast("Request cancelled.");
          load(me, "#links");
        }).catch(function (err) { R.toast(R.esc(err.message)); });
      });
    });
  }

  function loadEarnings() {
    return R.api("/api/me/earnings").then(function (d) {
      var html = R.earnProgress(d);
      var sec = document.getElementById("earnings");
      if (!html || !sec) return;
      var r = d.rules && d.rules.razed;
      sec.querySelector("[data-earnings]").innerHTML = html +
        (r ? '<p class="profile-section__intro">Every $' + R.money(r.per, 0) + " you wager on Razed under code " + R.esc(R.config.code) +
          " pays " + R.money(r.points, 0) + " Rekoj points, added to your balance automatically.</p>" : "");
      sec.hidden = false;
      if (d.months.some(function (m) { return m.credited; })) R.refreshPoints && R.refreshPoints();
    }).catch(function () {});
  }

  function load(me, focus) {
    return R.api("/api/me/activity").then(function (activity) {
      render(me, activity);
      loadEarnings();
    }).catch(function (err) {
      if (err.status === 401) return signedOut();
      render(me, { orders: [], raffles: [], links: {} });
      R.toast(R.esc(err.message));
    }).then(function () {
      var target = focus && document.querySelector(focus);
      if (target) target.scrollIntoView({ block: "start" });
    });
  }

  R.me().then(function (me) {
    if (!me.user) return signedOut();
    return load(me, location.hash === "#links" ? "#links" : null);
  });
})();
