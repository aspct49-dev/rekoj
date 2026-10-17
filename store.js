/*
 * Points Store: items come from the API (managed in /admin), with content.js
 * as the fallback. While content.js says storeOpen: false, the page shows
 * "Coming soon" over a blurred preview of the items instead. Search, the "Reward: Ascending / Descending" sort, and
 * buying with Rekoj points (BotRix). A purchase becomes an order an admin
 * fulfils; it shows on the buyer's profile.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var C = window.REKOJ_CONTENT;

  var grid = document.getElementById("storeGrid");
  var empty = document.getElementById("storeEmpty");
  var search = document.getElementById("storeSearch");
  var sort = document.getElementById("storeSort");
  // dir: null shows the items in their saved order (as in the design); the
  // sort control then switches between descending and ascending by cost.
  var state = { query: "", dir: null, items: fallbackItems() };

  function fallbackItems() {
    return C.store.map(function (item, i) {
      return { id: "fallback-" + i, name: item.name, cost: item.cost, tier: item.tier, image: item.image, stock: null };
    });
  }

  function imageSrc(image) {
    return C.storeImages[image] || image;
  }

  function itemHTML(item) {
    var tier = ["gold", "red", "purple", "blue"].indexOf(item.tier) >= 0 ? item.tier : "blue";
    var preset = Object.prototype.hasOwnProperty.call(C.storeImages, item.image);
    var soldOut = item.stock !== null && item.stock !== undefined && item.stock <= 0;
    return (
      '<article class="item item--' + tier + (soldOut ? " is-sold-out" : "") + '">' +
        '<div class="item__frame"></div>' +
        '<img class="item__bg" src="/assets/store/bg-' + tier + '.webp" alt="" width="218" height="118" />' +
        '<div class="item__pic item__pic--' + (preset ? R.esc(item.image) : "custom") + '">' +
          '<img src="' + R.esc(imageSrc(item.image)) + '" alt="" loading="lazy" />' +
        "</div>" +
        (item.stock !== null && item.stock !== undefined && !soldOut
          ? '<span class="item__stock">' + R.money(item.stock, 0) + " left</span>" : "") +
        '<img class="item__divider" src="/assets/store/divider.svg" alt="" width="207" height="1" />' +
        '<h2 class="item__name">' + R.esc(item.name) + "</h2>" +
        '<p class="item__cost"><img src="/assets/store/coin.webp" alt="Rekoj points" width="17" height="17" />' +
          "<span>" + R.money(item.cost, 0) + "</span></p>" +
        '<button class="item__buy" type="button" data-buy="' + R.esc(item.id) + '"' + (soldOut ? " disabled" : "") + ">" +
          (soldOut ? "SOLD OUT" : "PURCHASE") + "</button>" +
      "</article>"
    );
  }

  function render() {
    var q = state.query.trim().toLowerCase();
    var items = state.items
      .map(function (item, i) { return { item: item, i: i }; })
      .filter(function (x) { return !q || x.item.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) {
        if (!state.dir) return a.i - b.i;
        var d = state.dir === "asc" ? a.item.cost - b.item.cost : b.item.cost - a.item.cost;
        return d || a.i - b.i; // stable for equal prices
      });

    grid.innerHTML = items.map(function (x) { return itemHTML(x.item); }).join("");
    empty.hidden = items.length > 0;
  }

  function load() {
    return R.api("/api/store").then(function (data) {
      state.items = data.items || [];
      render();
    }).catch(function () { /* keep the built-in items */ });
  }

  /* ---------------- buying ---------------- */

  grid.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-buy]");
    if (!btn || btn.disabled) return;
    var item = state.items.filter(function (i) { return i.id === btn.getAttribute("data-buy"); })[0];
    if (!item) return;
    if (item.id.indexOf("fallback-") === 0) return R.toast("The store is offline right now. Please try again shortly.");

    R.me().then(function (me) {
      if (!me.user) return R.login();
      var balance = me.points ? me.points.points : null;
      var short = balance !== null && balance < item.cost;
      return R.confirm({
        title: short ? "Not enough points" : "Buy " + item.name + "?",
        html: short
          ? "<p>This costs <b>" + R.money(item.cost, 0) + "</b> points and you have <b>" + R.money(balance, 0) + "</b>.</p>" +
            "<p>Earn Rekoj points by watching <a href=\"https://kick.com/rekoj\" target=\"_blank\" rel=\"noopener\">RekoJ on Kick</a>.</p>"
          : "<p><b>" + R.money(item.cost, 0) + "</b> Rekoj points will be taken from your balance" +
            (balance !== null ? " (you have " + R.money(balance, 0) + ")" : "") + ".</p>" +
            "<p>Your order shows on your profile until RekoJ sends it to you.</p>",
        confirm: short ? "OK" : "Buy for " + R.money(item.cost, 0),
        cancel: short ? false : "Cancel",
      }).then(function (ok) {
        if (!ok || short) return;
        btn.disabled = true;
        return R.api("/api/store/redeem", { itemId: item.id }).then(function () {
          R.toast("Ordered <span class=\"accent\">" + R.esc(item.name) + "</span>. Track it on your profile.");
          R.refreshPoints();
          return load();
        }).catch(function (err) {
          R.toast(R.esc(err.message));
          if (err.status === 401) R.login();
        }).finally(function () { btn.disabled = false; });
      });
    });
  });

  /* ---------------- controls ---------------- */

  search.addEventListener("input", function () {
    state.query = search.value;
    render();
  });

  sort.addEventListener("click", function () {
    state.dir = state.dir === "desc" ? "asc" : "desc";
    sort.classList.toggle("is-desc", state.dir === "desc");
    sort.querySelector("[data-sort-label]").textContent = state.dir === "asc" ? "Ascending" : "Descending";
    render();
  });

  /* ---------------- coming soon ---------------- */

  function comingSoon() {
    var soon = document.getElementById("storeSoon");
    document.querySelector(".listing--store").classList.add("is-soon");
    document.querySelector(".filters").hidden = true;
    soon.hidden = false;
    // The real items, blurred and out of reach, as a teaser
    grid.setAttribute("aria-hidden", "true");
    grid.inert = true;
    var preview = function (items) { grid.innerHTML = items.slice(0, 10).map(itemHTML).join(""); };
    preview(state.items);
    R.api("/api/store").then(function (d) { if (d.items && d.items.length) preview(d.items); }).catch(function () {});

    var balance = soon.querySelector("[data-soon-balance]");
    R.me().then(function (me) {
      if (!me || !me.user) {
        balance.innerHTML = '<a href="' + R.loginUrl("/points-store") + '">Log in with Kick</a> to see how many points you have.';
      } else if (me.points) {
        balance.innerHTML = '<img src="/assets/store/coin.webp" alt="" width="18" height="18" /><span>You have <b>' + R.money(me.points.points, 0) + "</b> Rekoj points saved up.</span>";
      } else {
        balance.textContent = "Watch a stream with chat open to start earning Rekoj points.";
      }
      balance.hidden = false;
    }, function () {});
  }

  if (!C.storeOpen) return comingSoon();
  render();
  load();
})();
