/*
 * Admin panel (/admin): orders, linked casino accounts, store items, wager
 * raffles, BotRix points, players and stream overlays. Only Kick usernames in ADMIN_KICK_USERNAMES
 * get past the API; this page just hides itself from everyone else.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var C = window.REKOJ_CONTENT;
  var panel = document.getElementById("adminPanel");
  var tabs = document.getElementById("adminTabs");
  var who = document.getElementById("adminWho");
  var esc = R.esc;
  var money = function (n) { return R.money(n, 0); };

  var STORE_IMAGES = [["xbox", "Xbox One"], ["af1", "Air Force 1"], ["keyboard", "Keyboard"], ["bonusbuy", "Bonus buy"]];
  var RAFFLE_THUMBS = [["wanted", "Wanted Dead or a Wild"], ["gates", "Gates of Olympus 1000"], ["sweet-bonanza", "Sweet Bonanza 1000"]];
  var TIERS = [["gold", "Gold"], ["red", "Red"], ["purple", "Purple"], ["blue", "Blue"]];
  var CASINOS = [["razed", "Razed"], ["razedio", "Razed.IO"]];
  var CASINO_NAME = { razed: "Razed", razedio: "Razed.IO" };
  function dollars(n) { return "$" + R.money(n || 0, n % 1 ? 2 : 0); }
  function plural(n, one, many) { return money(n) + " " + (n === 1 ? one : many); }
  function ruleText(r) {
    return CASINO_NAME[r.casino] + " · " + dollars(r.perDollars) + " = " + plural(r.ticketsPer, "ticket", "tickets") +
      (r.minWager ? " · min " + dollars(r.minWager) : "") + (r.maxTickets ? " · max " + money(r.maxTickets) : "");
  }

  function when(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function img(src, presets) { return presets[src] || src; }
  function fail(err) { R.toast(esc(err.message)); }

  /* ---------------- form dialog ---------------- */

  /**
   * fields: [{ name, label, type: text|number|select|datetime|checkbox|imagepick, value, options, hint, placeholder }]
   * Resolves the values, or null if cancelled.
   */
  function formDialog(title, fields, confirmText) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog");
      d.className = "dialog dialog--form";
      d.innerHTML =
        '<form method="dialog" class="dialog__box">' +
          '<h2 class="dialog__title">' + esc(title) + "</h2>" +
          '<div class="dialog__body form">' + fields.map(fieldHTML).join("") + "</div>" +
          '<p class="form__error" hidden></p>' +
          '<div class="dialog__actions">' +
            '<button class="dialog__btn" value="cancel" type="submit" formnovalidate>Cancel</button>' +
            '<button class="dialog__btn dialog__btn--primary" value="ok" type="submit">' + esc(confirmText || "Save") + "</button>" +
          "</div>" +
        "</form>";
      document.body.appendChild(d);

      // image pickers: a built-in picture, an uploaded one, or a link
      Array.prototype.forEach.call(d.querySelectorAll("[data-imagepick]"), function (sel) {
        var name = sel.getAttribute("data-imagepick");
        var url = d.querySelector('[name="' + name + '__url"]');
        var upRow = d.querySelector('[data-upload-row="' + name + '"]');
        var sync = function () {
          url.closest(".form__row").hidden = sel.value !== "__url";
          upRow.hidden = sel.value !== "__upload";
        };
        sel.addEventListener("change", sync); sync();
        wireUpload(d, name);
      });

      d.addEventListener("close", function () {
        if (d.returnValue !== "ok") { resolve(null); return setTimeout(function () { d.remove(); }, 200); }
        var out = {};
        fields.forEach(function (f) {
          var el = d.querySelector('[name="' + f.name + '"]');
          if (f.type === "checkbox") out[f.name] = el.checked;
          else if (f.type === "imagepick") {
            out[f.name] = el.value === "__url" ? d.querySelector('[name="' + f.name + '__url"]').value.trim()
              : el.value === "__upload" ? d.querySelector('[name="' + f.name + '__uploaded"]').value : el.value;
          }
          else if (f.type === "datetime") out[f.name] = el.value ? new Date(el.value).toISOString() : "";
          else out[f.name] = el.value;
        });
        resolve(out);
        setTimeout(function () { d.remove(); }, 200);
      });
      d.showModal();
      var first = d.querySelector("input, select");
      if (first) first.focus();
    });
  }

  function fieldHTML(f) {
    var id = "f_" + f.name;
    var label = '<label class="form__label" for="' + id + '">' + esc(f.label) + "</label>";
    var hint = f.hint ? '<small class="form__hint">' + esc(f.hint) + "</small>" : "";
    var v = f.value == null ? "" : f.value;
    if (f.type === "checkbox") {
      return '<div class="form__row form__row--check"><input id="' + id + '" name="' + f.name + '" type="checkbox"' + (v ? " checked" : "") + " />" + label + hint + "</div>";
    }
    if (f.type === "select") {
      return '<div class="form__row">' + label + '<select id="' + id + '" name="' + f.name + '">' +
        f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
        "</select>" + hint + "</div>";
    }
    if (f.type === "imagepick") {
      var preset = f.options.some(function (o) { return o[0] === v; });
      var uploaded = /^\/api\/image\//.test(v);
      var linked = v && !preset && !uploaded;
      return '<div class="form__row">' + label + '<select id="' + id + '" name="' + f.name + '" data-imagepick="' + f.name + '">' +
          f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
          '<option value="__upload"' + (uploaded ? " selected" : "") + ">Upload an image…</option>" +
          '<option value="__url"' + (linked ? " selected" : "") + ">Custom image link…</option>" +
        "</select>" + hint + "</div>" +
        '<div class="form__row form__upload" data-upload-row="' + f.name + '">' +
          '<label class="form__label" for="' + id + '_file">Image file</label>' +
          '<div class="upload">' +
            '<img class="upload__preview" data-upload-preview alt="" ' + (uploaded ? 'src="' + esc(v) + '"' : "hidden") + " />" +
            '<div class="upload__side">' +
              '<input id="' + id + '_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload-file />' +
              '<small class="form__hint" data-upload-status>' + (uploaded ? "Current picture. Choose a file to replace it." : "PNG, JPEG, WebP or GIF. It's resized and converted for the web automatically.") + "</small>" +
            "</div>" +
          "</div>" +
          '<input type="hidden" name="' + f.name + '__uploaded" value="' + esc(uploaded ? v : "") + '" />' +
        "</div>" +
        '<div class="form__row"><label class="form__label" for="' + id + '_url">Image link (https://)</label>' +
        '<input id="' + id + '_url" name="' + f.name + '__url" type="url" placeholder="https://…" value="' + esc(linked ? v : "") + '" /></div>';
    }
    var type = f.type === "datetime" ? "datetime-local" : f.type === "number" ? "number" : "text";
    if (f.type === "datetime" && v) {
      var dt = new Date(v);
      v = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    return '<div class="form__row">' + label + '<input id="' + id + '" name="' + f.name + '" type="' + type + '" value="' + esc(v) + '"' +
      (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + (f.required ? " required" : "") +
      (f.type === "number" ? ' step="' + (f.step || 1) + '" min="' + (f.min == null ? "" : f.min) + '"' : "") + " />" + hint + "</div>";
  }

  /* ---------------- image upload ---------------- */

  var MAX_UPLOAD = 170 * 1024; // the server takes up to 180 KB

  /** Shrink to at most 640px on the long side and encode as WebP under MAX_UPLOAD. */
  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error("Choose a PNG, JPEG, WebP or GIF image."));
      var img = new Image();
      var src = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(src);
        var attempt = function (maxSide, quality) {
          var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          var url = c.toDataURL("image/webp", quality);
          if (url.indexOf("data:image/webp") !== 0) url = c.toDataURL("image/png"); // browsers without WebP encoding
          var bytes = Math.ceil((url.length - url.indexOf(",") - 1) * 3 / 4);
          if (bytes <= MAX_UPLOAD) return resolve(url);
          if (quality > 0.55) return attempt(maxSide, quality - 0.1);
          if (maxSide > 240) return attempt(Math.round(maxSide * 0.75), 0.8);
          reject(new Error("That image is too detailed to shrink enough. Try another one."));
        };
        attempt(640, 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error("That file couldn't be read as an image.")); };
      img.src = src;
    });
  }

  function wireUpload(d, name) {
    var row = d.querySelector('[data-upload-row="' + name + '"]');
    var file = row.querySelector("[data-upload-file]");
    var status = row.querySelector("[data-upload-status]");
    var preview = row.querySelector("[data-upload-preview]");
    var hidden = d.querySelector('[name="' + name + '__uploaded"]');
    var save = d.querySelector(".dialog__btn--primary");
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) return;
      save.disabled = true;
      status.classList.remove("is-error");
      status.textContent = "Uploading…";
      prepareImage(f).then(function (dataUrl) {
        preview.src = dataUrl;
        preview.hidden = false;
        return R.api("/api/admin/images", { data: dataUrl });
      }).then(function (res) {
        hidden.value = res.url;
        status.textContent = "Uploaded. Save to use it.";
      }).catch(function (err) {
        hidden.value = "";
        preview.hidden = true;
        status.classList.add("is-error");
        status.textContent = err.message;
      }).then(function () { save.disabled = false; });
    });
  }

  /* ---------------- tabs ---------------- */

  var current = "overview";
  var currentSub = null;
  var views = {};
  var timers = [];

  /** Run fn every ms while the current view is showing. */
  function every(fn, ms) { timers.push(setInterval(fn, ms)); }

  /** show("raffles") or show("raffles", id) for a raffle's own page. */
  function show(tab, sub) {
    timers.forEach(clearInterval);
    timers = [];
    current = tab;
    currentSub = sub || null;
    Array.prototype.forEach.call(tabs.querySelectorAll("[data-tab]"), function (b) {
      b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab));
    });
    history.replaceState(null, "", "#" + tab + (sub ? "/" + sub : ""));
    panel.innerHTML = '<p class="admin__loading">Loading…</p>';
    views[tab](currentSub);
  }

  /** go("raffles/abc") */
  function go(path) {
    var parts = path.split("/");
    show(parts[0], parts.slice(1).join("/") || null);
    window.scrollTo({ top: 0 });
  }

  tabs.addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]");
    if (b) show(b.getAttribute("data-tab"));
  });

  function setPending(n) { setBadge("pendingBadge", n); }
  function setLinkBadge(n) { setBadge("linksBadge", n); }
  function setRaffleBadge(n) { setBadge("rafflesBadge", n); }
  function setMessageBadge(n) { setBadge("messagesBadge", n); }
  function refreshBadges() {
    return R.api("/api/admin/overview").then(function (d) {
      setPending(d.counts.pending); setLinkBadge(d.counts.linkRequests); setRaffleBadge(d.counts.readyToDraw); setMessageBadge(d.counts.newMessages);
    }, function () {});
  }
  function setBadge(id, n) {
    var badge = document.getElementById(id);
    if (!badge) return;
    badge.hidden = !n;
    badge.textContent = n;
  }

  /* ---------------- overview ---------------- */

  views.overview = function () {
    R.api("/api/admin/overview").then(function (d) {
      setPending(d.counts.pending);
      setLinkBadge(d.counts.linkRequests);
      setRaffleBadge(d.counts.readyToDraw);
      setMessageBadge(d.counts.newMessages);
      var s = d.setup;
      var check = function (ok, title, okText, badText) {
        return '<li class="setup ' + (ok ? "setup--ok" : "setup--bad") + '"><b>' + (ok ? "✓" : "!") + "</b><span><strong>" + title + "</strong>" +
          esc(ok ? okText : badText) + "</span></li>";
      };
      panel.innerHTML =
        '<div class="admin-tiles">' +
          tile("Pending orders", d.counts.pending, "orders") + tile("Link requests", d.counts.linkRequests, "links") + tile("Open raffles", d.counts.openRaffles, "raffles") +
          tile("Raffles to draw", d.counts.readyToDraw, "raffles") + tile("New messages", d.counts.newMessages, "messages") +
          tile("Items on sale", d.counts.items, "store") + tile("Players", d.counts.users, "players") +
        "</div>" +
        '<div class="admin-grid">' +
          '<section class="admin-card"><h2 class="admin-card__title">Setup</h2><ul class="setups">' +
            check(s.kick, "Kick login", "Players can sign in with Kick.", "Add KICK_CLIENT_ID and KICK_CLIENT_SECRET.") +
            check(s.botrix, "BotRix points", "The store spends points on BotRix channel " + s.channel + ".", "Add BOTRIX_BID.") +
            check(true, "Points Store", s.storeOpen ? "Open: viewers can buy items." :
              "Showing \"Coming soon\"; purchases are switched off. Set storeOpen: true in content.js to open it.", "") +
            check(s.razed && s.razedio, "Wager data", "Razed and Razed.IO wagers feed raffle tickets.",
              (s.razed ? "" : "Add RAZED_REFERRAL_KEY. ") + (s.razedio ? "" : "Add RAZEDIO_API_KEY. ") + "Raffles on that casino can't count tickets without it.") +
            check(s.storage !== "none", "Database", s.storage === "postgres" ? "Neon Postgres is connected." : "Saving to local files (development).",
              "Add DATABASE_URL (Neon, from Vercel → Storage) so orders and raffles can be saved.") +
            check(true, "Contact form", s.contactRelay ? "Messages land in the Messages tab and are forwarded to Discord." :
              "Messages land in the Messages tab. Set CONTACT_DISCORD_WEBHOOK to also get them in a Discord channel.", "") +
            check(true, "Admins", "Kick accounts: " + s.admins + " (ADMIN_KICK_USERNAMES).", "") +
          "</ul></section>" +
          '<section class="admin-card"><h2 class="admin-card__title">Latest orders</h2>' +
            (d.recentOrders.length ? '<ul class="mini-list">' + d.recentOrders.map(function (o) {
              return "<li><b>" + esc(o.username) + "</b> " + esc(o.itemName) + ' <span class="pill pill--' + pillClass(o.status) + '">' + statusLabel(o.status) + "</span><small>" + when(o.at) + "</small></li>";
            }).join("") + "</ul>" : '<p class="admin-muted">No orders yet.</p>') +
          "</section>" +
          '<section class="admin-card"><h2 class="admin-card__title">Raffle activity <a class="admin-card__more" href="#raffles" data-go="raffles">All raffles →</a></h2>' +
            ((d.raffleActivity || []).length ? '<ul class="mini-list mini-list--log">' + d.raffleActivity.map(function (l) { return logLine(l, true); }).join("") + "</ul>"
              : '<p class="admin-muted">Nothing yet. Joins, draws and changes show up here.</p>') +
          "</section>" +
        "</div>";
      Array.prototype.forEach.call(panel.querySelectorAll("[data-go]"), function (a) {
        a.addEventListener("click", function (e) { e.preventDefault(); go(a.getAttribute("data-go")); });
      });
    }).catch(fail);
  };

  function tile(label, n, tab) {
    return '<button class="admin-tile" type="button" data-go="' + tab + '"><span class="admin-tile__n">' + money(n) + '</span><span class="admin-tile__label">' + label + "</span></button>";
  }
  function statusLabel(s) { return { pending: "Pending", fulfilled: "Sent", rejected: "Refunded" }[s] || s; }
  function pillClass(s) { return { pending: "pending", fulfilled: "done", rejected: "refunded" }[s] || "muted"; }

  /* ---------------- orders ---------------- */

  var orderFilter = "pending";
  views.orders = function () {
    R.api("/api/admin/redemptions").then(function (d) {
      var all = d.orders;
      setPending(all.filter(function (o) { return o.status === "pending"; }).length);
      var list = orderFilter === "pending" ? all.filter(function (o) { return o.status === "pending"; }) : all;
      panel.innerHTML =
        '<div class="admin-toolbar">' +
          '<div class="seg" role="group" aria-label="Show">' +
            '<button type="button" data-filter="pending" aria-pressed="' + (orderFilter === "pending") + '">Pending</button>' +
            '<button type="button" data-filter="all" aria-pressed="' + (orderFilter === "all") + '">All orders</button>' +
          "</div>" +
          '<p class="admin-muted">Points are taken when a player orders. Rejecting gives them back automatically.</p>' +
        "</div>" +
        (list.length ? '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Player</th><th>Item</th><th>Points</th><th>Ordered</th><th>Status</th><th></th></tr></thead><tbody>' +
          list.map(function (o) {
            return "<tr><td>" + player(o.username, o.avatar) + "</td><td>" + esc(o.itemName) + "</td><td>" + money(o.cost) + "</td><td>" + when(o.at) + "</td>" +
              '<td><span class="pill pill--' + pillClass(o.status) + '">' + statusLabel(o.status) + "</span>" +
                (o.handledBy ? '<small class="admin-muted"> by ' + esc(o.handledBy) + "</small>" : "") + (o.note ? '<small class="admin-muted"> · ' + esc(o.note) + "</small>" : "") + "</td>" +
              '<td class="admin-actions">' + (o.status === "pending"
                ? '<button class="abtn abtn--ok" type="button" data-fulfil="' + o.id + '">Mark sent</button><button class="abtn abtn--danger" type="button" data-reject="' + o.id + '">Reject &amp; refund</button>'
                : "") + "</td></tr>";
          }).join("") + "</tbody></table></div>"
          : '<p class="admin-empty">' + (orderFilter === "pending" ? "No pending orders. Nice." : "No orders yet.") + "</p>");

      panel.querySelectorAll("[data-filter]").forEach(function (b) {
        b.addEventListener("click", function () { orderFilter = b.getAttribute("data-filter"); views.orders(); });
      });
      panel.querySelectorAll("[data-fulfil]").forEach(function (b) {
        b.addEventListener("click", function () { decide(b.getAttribute("data-fulfil"), "fulfil", all); });
      });
      panel.querySelectorAll("[data-reject]").forEach(function (b) {
        b.addEventListener("click", function () { decide(b.getAttribute("data-reject"), "reject", all); });
      });
    }).catch(fail);
  };

  function decide(id, action, all) {
    var o = all.filter(function (x) { return x.id === id; })[0];
    formDialog(action === "fulfil" ? "Mark as sent?" : "Reject and refund?", [
      { name: "note", label: action === "fulfil" ? "Note to the player (optional)" : "Reason (shown to the player)", type: "text",
        placeholder: action === "fulfil" ? "e.g. Sent to your Razed account" : "e.g. Out of stock",
        hint: o.username + " · " + o.itemName + " · " + money(o.cost) + " points" + (action === "reject" ? " will be returned" : "") },
    ], action === "fulfil" ? "Mark sent" : "Reject & refund").then(function (v) {
      if (!v) return;
      return R.api("/api/admin/redemptions", { id: id, action: action, note: v.note }).then(function () {
        R.toast(action === "fulfil" ? "Marked as sent." : "Rejected; points returned.");
        views.orders();
      });
    }).catch(fail);
  }

  function player(name, avatar) {
    return '<span class="aplayer"><img src="' + esc(avatar || "/assets/shared/rekoj-logo.webp") + '" alt="" width="24" height="24" />' + esc(name) + "</span>";
  }

  /* ---------------- store ---------------- */

  views.store = function () {
    R.api("/api/admin/store").then(function (d) {
      panel.innerHTML =
        (C.storeOpen ? "" : '<p class="admin-notice">The Points Store is showing <b>Coming soon</b> and purchases are off. Set up the items here; set <code>storeOpen: true</code> in content.js to open it.</p>') +
        '<div class="admin-toolbar"><button class="abtn abtn--primary" type="button" data-new>+ New item</button>' +
        '<p class="admin-muted">Items show on the Points Store in this order. Hidden items stay here but aren\'t for sale.</p></div>' +
        '<div class="admin-items">' + d.items.map(function (i) {
          return '<article class="aitem aitem--' + esc(i.tier) + (i.hidden ? " is-hidden" : "") + '">' +
            '<img src="' + esc(img(i.image, C.storeImages)) + '" alt="" loading="lazy" />' +
            '<div class="aitem__main"><b>' + esc(i.name) + "</b><small>" + money(i.cost) + " points · " +
              (i.stock === null || i.stock === undefined ? "unlimited" : money(i.stock) + " in stock") + (i.hidden ? " · hidden" : "") + "</small></div>" +
            '<div class="admin-actions"><button class="abtn" type="button" data-edit="' + i.id + '">Edit</button>' +
            '<button class="abtn abtn--danger" type="button" data-del="' + i.id + '">Delete</button></div>' +
          "</article>";
        }).join("") + "</div>";

      panel.querySelector("[data-new]").addEventListener("click", function () { editItem(null); });
      panel.querySelectorAll("[data-edit]").forEach(function (b) {
        b.addEventListener("click", function () { editItem(d.items.filter(function (i) { return i.id === b.getAttribute("data-edit"); })[0]); });
      });
      panel.querySelectorAll("[data-del]").forEach(function (b) {
        b.addEventListener("click", function () {
          var item = d.items.filter(function (i) { return i.id === b.getAttribute("data-del"); })[0];
          R.confirm({ title: "Delete " + item.name + "?", html: "<p>It disappears from the store. Existing orders aren't affected.</p>", confirm: "Delete", danger: true })
            .then(function (ok) {
              if (ok) return R.api("/api/admin/store/delete", { id: item.id }).then(function () { R.toast("Deleted."); views.store(); });
            }).catch(fail);
        });
      });
    }).catch(fail);
  };

  function editItem(item) {
    var i = item || { tier: "blue", image: "bonusbuy", stock: null, hidden: false };
    formDialog(item ? "Edit item" : "New item", [
      { name: "name", label: "Name", type: "text", value: i.name, required: true, placeholder: "e.g. $50 Bonus Buy" },
      { name: "cost", label: "Price (Rekoj points)", type: "number", value: i.cost, required: true },
      { name: "tier", label: "Colour", type: "select", value: i.tier, options: TIERS },
      { name: "image", label: "Picture", type: "imagepick", value: i.image, options: STORE_IMAGES },
      { name: "stock", label: "Stock", type: "number", value: i.stock === null || i.stock === undefined ? "" : i.stock, hint: "Leave empty for unlimited." },
      { name: "hidden", label: "Hidden from the store", type: "checkbox", value: i.hidden },
    ], item ? "Save" : "Add item").then(function (v) {
      if (!v) return;
      v.id = item ? item.id : undefined;
      v.stock = v.stock === "" ? null : v.stock;
      return R.api("/api/admin/store", { item: v }).then(function () { R.toast(item ? "Saved." : "Added."); views.store(); });
    }).catch(fail);
  }

  /* ---------------- raffles ---------------- */

  var raffleFilter = "open";
  var raffleQuery = "";
  var STATE_PILL = { open: ["Open", "pending"], ended: ["Ready to draw", "refunded"], drawn: ["Drawn", "done"] };
  var LOG_LABEL = {
    created: "Created", edited: "Edited", ended: "Ended early", deleted: "Deleted", joined: "Joined",
    removed: "Removed", reinstated: "Allowed back", drawn: "Drew winners", redrawn: "Redrew winners",
  };

  function countdown(iso) {
    var s = Math.floor((Date.parse(iso) - Date.now()) / 1000);
    if (s <= 0) return "ended";
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + "d " + h + "h " + m + "m" : h ? h + "h " + m + "m " + (s % 60) + "s" : m + "m " + (s % 60) + "s";
  }
  function clock(ts) { return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function statePill(r) {
    var p = STATE_PILL[r.state] || ["?", "muted"];
    if (r.state === "ended" && !(r.entries || []).length && r.entriesCount === 0) p = ["Ended · no entries", "muted"];
    return '<span class="pill pill--' + p[1] + '">' + p[0] + "</span>";
  }
  function timing(r) {
    if (r.state === "open") return 'Ends in <b data-countdown="' + esc(r.endsAt) + '">' + countdown(r.endsAt) + "</b>";
    if (r.state === "drawn") return "Drawn " + when(r.drawnAt) + (r.drawnBy ? " by " + esc(r.drawnBy) : "");
    return "Ended " + when(Date.parse(r.endsAt));
  }
  function overlayUrl(r) { return location.origin + "/overlay/raffle?id=" + encodeURIComponent(r.id); }
  function logLine(l, withGame) {
    return "<li><b>" + esc(LOG_LABEL[l.type] || l.type) + "</b>" + (withGame ? " · " + esc(l.game) : "") +
      (l.by ? " <span class=\"admin-muted\">by " + esc(l.by) + "</span>" : "") +
      "<small>" + (l.detail ? esc(l.detail) + " · " : "") + when(l.at) + "</small></li>";
  }

  // Shared actions, used from the list and from a raffle's page
  function raffleActions(r, after) {
    return {
      edit: function () { editRaffle(r, after); },
      duplicate: function () {
        R.api("/api/admin/raffles/duplicate", { id: r.id }).then(function (d) {
          R.toast("Copied. Edit the dates and prize, then it's live.");
          go("raffles/" + d.raffle.id);
          editRaffle(d.raffle, after);
        }).catch(fail);
      },
      end: function () {
        R.confirm({
          title: "End " + r.game + " now?",
          html: "<p>The raffle closes straight away: nobody else can join and wagers stop counting now. You can then draw the winners.</p>",
          confirm: "End now", danger: true,
        }).then(function (ok) {
          if (ok) return R.api("/api/admin/raffles/end", { id: r.id }).then(function () { R.toast("Ended. Ready to draw."); refreshBadges(); after(); });
        }).catch(fail);
      },
      draw: function () {
        var redraw = r.state === "drawn";
        R.confirm({
          title: (redraw ? "Redraw " : "Draw ") + r.game + "?",
          html: "<p>Fetches everyone's latest " + CASINO_NAME[r.casino] + " wagers, then picks " + plural(r.winners, "winner", "winners") +
            " at random, weighted by tickets. Entries with no tickets can't win." +
            (redraw ? " The current winners are replaced; the earlier draw stays in the history." : "") +
            "</p><p>The raffle overlay shows the winners straight away.</p>",
          confirm: redraw ? "Redraw" : "Draw winners",
        }).then(function (ok) {
          if (!ok) return;
          return R.api("/api/admin/raffles/draw", { id: r.id }).then(function (res) {
            R.toast("Winners: " + res.raffle.winnersList.map(function (w) { return esc(w.username) + " (" + money(w.tickets) + ")"; }).join(", "));
            refreshBadges();
            after();
          });
        }).catch(fail);
      },
      overlay: function () {
        R.copyText(overlayUrl(r)).then(function () { R.toast("Overlay link for this raffle copied."); }, function () { R.toast(esc(overlayUrl(r))); });
      },
      del: function () {
        var n = r.entriesCount != null ? r.entriesCount : (r.entries || []).length;
        R.confirm({
          title: "Delete this raffle?",
          html: "<p><b>" + esc(R.raffleLabel(r)) + "</b> and its " + plural(n, "entry", "entries") + " disappear from the site. This can't be undone.</p>",
          confirm: "Delete", danger: true,
        }).then(function (ok) {
          if (ok) return R.api("/api/admin/raffles/delete", { id: r.id }).then(function () { R.toast("Deleted."); refreshBadges(); go("raffles"); });
        }).catch(fail);
      },
    };
  }

  views.raffles = function (sub) {
    if (sub) return raffleDetail(sub);
    var stats = null, list = [], updated = 0;

    function filtered() {
      var q = raffleQuery.trim().toLowerCase();
      return list.filter(function (r) {
        var f = raffleFilter === "all" || (raffleFilter === "ready" ? r.state === "ended" : r.state === raffleFilter);
        return f && (!q || (r.game + " " + r.prize).toLowerCase().indexOf(q) !== -1);
      });
    }

    function render() {
      var count = function (st) { return list.filter(function (r) { return r.state === st; }).length; };
      var open = list.filter(function (r) { return r.state === "open"; });
      var sum = function (key) {
        if (!stats) return "…";
        return money(open.reduce(function (s, r) { return s + ((stats[r.id] || {})[key] || 0); }, 0));
      };
      var rows = filtered();
      var focus = document.activeElement && document.activeElement.name === "q";
      panel.innerHTML =
        '<div class="admin-tiles">' +
          '<button class="admin-tile" type="button" data-filter="open"><span class="admin-tile__n">' + count("open") + '</span><span class="admin-tile__label">Open raffles</span></button>' +
          '<button class="admin-tile' + (count("ended") ? " admin-tile--alert" : "") + '" type="button" data-filter="ready"><span class="admin-tile__n">' + count("ended") + '</span><span class="admin-tile__label">Ready to draw</span></button>' +
          '<div class="admin-tile admin-tile--static"><span class="admin-tile__n">' + sum("entries") + '</span><span class="admin-tile__label">Entries in open raffles</span></div>' +
          '<div class="admin-tile admin-tile--static"><span class="admin-tile__n">' + sum("tickets") + '</span><span class="admin-tile__label">Tickets in open raffles</span></div>' +
        "</div>" +
        '<div class="admin-toolbar">' +
          '<button class="abtn abtn--primary" type="button" data-new>+ New raffle</button>' +
          '<div class="seg" role="group" aria-label="Show">' +
            [["open", "Open"], ["ready", "Ready to draw"], ["drawn", "Drawn"], ["all", "All"]].map(function (f) {
              var n = f[0] === "all" ? list.length : f[0] === "ready" ? count("ended") : count(f[0]);
              return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (raffleFilter === f[0]) + '">' + f[1] + " <span class=\"seg__n\">" + n + "</span></button>";
            }).join("") +
          "</div>" +
          '<input class="admin-search" name="q" type="search" placeholder="Search raffles" value="' + esc(raffleQuery) + '" />' +
          '<span class="admin-live"><span class="admin-live__dot"></span>' + (updated ? "Updated " + clock(updated) : "Loading…") + "</span>" +
          '<button class="abtn" type="button" data-refresh>Refresh</button>' +
        "</div>" +
        (rows.length
          ? '<div class="admin-table-wrap"><table class="admin-table admin-table--raffles"><thead><tr><th>Raffle</th><th>Status</th><th>Entries</th><th>Tickets</th><th>Leading</th><th></th></tr></thead><tbody>' +
            rows.map(function (r) {
              var st = stats && stats[r.id];
              var entries = st && st.entries != null ? money(st.entries) : money((r.entries || []).length);
              var tickets = !st ? "…" : st.error ? '<span class="admin-warn" title="' + esc(st.error) + '">unavailable</span>' : st.tickets != null ? money(st.tickets) : "—";
              var lead = r.state === "drawn" ? (r.winnersList || []).map(function (w) { return esc(w.username); }).join(", ") || "—"
                : st && st.top ? esc(st.top.username) + ' <span class="admin-muted">' + money(st.top.tickets) + "</span>" : st ? "—" : "…";
              return '<tr class="admin-row" data-open="' + r.id + '" tabindex="0">' +
                '<td><div class="raffle-cell"><img src="' + esc(img(r.thumb, C.raffleThumbs)) + '" alt="" loading="lazy" /><div><b>' + esc(R.raffleLabel(r)) + "</b>" +
                  (r.placeholder ? ' <span class="pill pill--muted">Placeholder</span>' : "") +
                  "<small>" + esc(ruleText(r)) + " · " + plural(r.winners, "winner", "winners") + "</small></div></div></td>" +
                "<td>" + statePill(r) + "<small>" + timing(r) + "</small></td>" +
                "<td>" + entries + "</td><td>" + tickets + "</td>" +
                "<td>" + (r.state === "drawn" ? '<span class="admin-muted">Won:</span> ' : "") + lead + "</td>" +
                '<td class="admin-actions">' +
                  (r.state === "ended" && (r.entries || []).length ? '<button class="abtn abtn--ok" type="button" data-draw="' + r.id + '">Draw</button>' : "") +
                  '<button class="abtn" type="button" data-manage="' + r.id + '">Manage</button>' +
                "</td></tr>";
            }).join("") + "</tbody></table></div>"
          : '<p class="admin-empty">' + (list.length ? "No raffles here." : "No raffles yet. Create one to get started.") + "</p>");

      var find = function (id) { return list.filter(function (r) { return r.id === id; })[0]; };
      panel.querySelector("[data-new]").addEventListener("click", function () { editRaffle(null, load); });
      panel.querySelector("[data-refresh]").addEventListener("click", load);
      panel.querySelectorAll("[data-filter]").forEach(function (b) {
        b.addEventListener("click", function () { raffleFilter = b.getAttribute("data-filter"); render(); });
      });
      var search = panel.querySelector('[name="q"]');
      search.addEventListener("input", function () { raffleQuery = search.value; render(); });
      if (focus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
      panel.querySelectorAll("[data-open]").forEach(function (row) {
        row.addEventListener("click", function (e) {
          if (e.target.closest("button")) return;
          go("raffles/" + row.getAttribute("data-open"));
        });
        row.addEventListener("keydown", function (e) { if (e.key === "Enter") go("raffles/" + row.getAttribute("data-open")); });
      });
      panel.querySelectorAll("[data-manage]").forEach(function (b) {
        b.addEventListener("click", function () { go("raffles/" + b.getAttribute("data-manage")); });
      });
      panel.querySelectorAll("[data-draw]").forEach(function (b) {
        b.addEventListener("click", function () { raffleActions(find(b.getAttribute("data-draw")), load).draw(); });
      });
    }

    function load() {
      return R.api("/api/admin/raffles").then(function (d) {
        var order = { ended: 0, open: 1, drawn: 2 };
        list = d.raffles.slice().sort(function (a, b) {
          return order[a.state] - order[b.state] || (a.state === "drawn" ? (b.drawnAt || 0) - (a.drawnAt || 0) : Date.parse(a.endsAt) - Date.parse(b.endsAt));
        });
        setRaffleBadge(list.filter(function (r) { return r.state === "ended" && (r.entries || []).length; }).length);
        if (!updated && raffleFilter === "open" && !list.some(function (r) { return r.state === "open"; })) raffleFilter = "all";
        updated = Date.now();
        render();
        // Live tickets come from the casinos, so they follow a moment later
        return R.api("/api/admin/raffles/stats").then(function (s) { stats = s.stats; updated = s.at; if (current === "raffles" && !currentSub) render(); });
      }).catch(fail);
    }

    load();
    every(load, 60000);
    every(function () {
      panel.querySelectorAll("[data-countdown]").forEach(function (el) { el.textContent = countdown(el.getAttribute("data-countdown")); });
    }, 1000);
  };

  function raffleDetail(id) {
    function load() {
      return R.api("/api/admin/raffles/detail?id=" + encodeURIComponent(id)).then(render).catch(function (err) {
        panel.innerHTML = '<p class="admin-empty">' + esc(err.message) + ' <a class="accent" href="#raffles" data-back>Back to raffles</a></p>';
        panel.querySelector("[data-back]").addEventListener("click", function (e) { e.preventDefault(); go("raffles"); });
      });
    }

    function render(d) {
      var r = d.raffle, s = d.summary;
      r.entriesCount = s.entries;
      var act = raffleActions(r, load);
      var list = d.entries.slice().sort(function (a, b) { return (b.tickets || 0) - (a.tickets || 0) || a.at - b.at; });
      var total = s.tickets || 0;
      var winners = r.winnersList || [];
      var canRemove = r.state !== "drawn";
      panel.innerHTML =
        '<a class="admin-back" href="#raffles" data-back>← All raffles</a>' +
        '<section class="admin-card raffle-head">' +
          '<img class="raffle-head__thumb" src="' + esc(img(r.thumb, C.raffleThumbs)) + '" alt="" />' +
          '<div class="raffle-head__main">' +
            '<h2 class="raffle-head__title">' + esc(R.raffleLabel(r)) + " " + statePill(r) +
              (r.placeholder ? ' <span class="pill pill--muted">Placeholder from the design</span>' : "") + "</h2>" +
            '<p class="raffle-head__meta">' + timing(r) + " · " + plural(r.winners, "winner", "winners") + " · prize value " + dollars(r.value) + "</p>" +
            '<p class="raffle-head__meta">' + esc(ruleText(r)) + " · wagers count " + when(Date.parse(r.wagerFrom)) + " → " + when(Date.parse(r.endsAt)) +
              (r.casino === "razed" ? " (whole UTC days)" : "") + "</p>" +
            '<div class="admin-actions raffle-head__actions">' +
              (r.state !== "open" && s.entries ? '<button class="abtn abtn--ok" type="button" data-act="draw">' + (r.state === "drawn" ? "Redraw" : "Draw winners") + "</button>" : "") +
              (r.state === "open" ? '<button class="abtn" type="button" data-act="end">End now</button>' : "") +
              '<button class="abtn" type="button" data-act="edit">Edit</button>' +
              '<button class="abtn" type="button" data-act="duplicate">Duplicate</button>' +
              '<button class="abtn" type="button" data-act="overlay">Copy overlay link</button>' +
              '<a class="abtn" href="/overlay/raffle?id=' + encodeURIComponent(r.id) + '" target="_blank" rel="noopener">Open overlay</a>' +
              (list.length ? '<button class="abtn" type="button" data-act="csv">Export CSV</button>' : "") +
              '<button class="abtn abtn--danger" type="button" data-act="del">Delete</button>' +
            "</div>" +
          "</div>" +
        "</section>" +
        '<div class="admin-tiles">' +
          statTile(money(s.entries), "Entries") + statTile(money(s.eligible), "With tickets") +
          statTile(money(total), "Tickets") + statTile(dollars(s.wagered), "Wagered in window") +
        "</div>" +
        '<div class="admin-toolbar admin-toolbar--tight">' +
          '<span class="admin-live' + (d.snapshot ? " admin-live--off" : "") + '"><span class="admin-live__dot"></span>' +
            (d.snapshot ? "Numbers as drawn on " + when(r.drawnAt) : "Live · updated " + clock(d.at) + " · refreshes every minute") + "</span>" +
          (d.snapshot ? "" : '<button class="abtn" type="button" data-refresh>Refresh</button>') +
          (d.error ? '<span class="admin-warn">Couldn\'t load wagers: ' + esc(d.error) + "</span>" : "") +
        "</div>" +
        '<div class="raffle-detail">' +
          '<section class="admin-card raffle-detail__entries"><h2 class="admin-card__title">Entries <span class="admin-muted">' + money(list.length) + "</span></h2>" +
            (list.length
              ? '<div class="admin-table-wrap admin-table-wrap--flat"><table class="admin-table admin-table--tight"><thead><tr><th>#</th><th>Kick</th><th>' + CASINO_NAME[r.casino] +
                  "</th><th>Wagered</th><th>Tickets</th><th>Odds</th><th>Joined</th>" + (canRemove ? "<th></th>" : "") + "</tr></thead><tbody>" +
                list.map(function (e, i) {
                  var won = winners.some(function (w) { return w.userId === e.userId; });
                  return '<tr' + (won ? ' class="is-winner"' : "") + "><td>" + (i + 1) + "</td><td>" + esc(e.username) + (won ? ' <span class="pill pill--done">Won</span>' : "") + "</td>" +
                    "<td>" + (e.casinoUsername ? esc(e.casinoUsername) : '<span class="admin-warn">not linked</span>') + "</td>" +
                    "<td>" + (e.wagered == null ? "—" : dollars(e.wagered)) + "</td><td><b>" + (e.tickets == null ? "—" : money(e.tickets)) + "</b></td>" +
                    "<td>" + (total && e.tickets ? (e.tickets / total * 100).toFixed(1) + "%" : "—") + "</td>" +
                    "<td>" + when(e.at) + "</td>" +
                    (canRemove ? '<td class="admin-actions"><button class="abtn abtn--danger abtn--sm" type="button" data-remove="' + esc(e.userId) + '">Remove</button></td>' : "") +
                    "</tr>";
                }).join("") + "</tbody></table></div>"
              : '<p class="admin-muted">Nobody has joined yet. Players with an approved ' + CASINO_NAME[r.casino] + " link can join on the Raffles page.</p>") +
            (d.removed.length
              ? '<h3 class="admin-subtitle">Removed</h3><ul class="mini-list">' + d.removed.map(function (x) {
                  return "<li><b>" + esc(x.username) + "</b> " + (x.reason ? esc(x.reason) : "") + " <small>by " + esc(x.by) + " · " + when(x.at) + "</small>" +
                    '<button class="abtn abtn--sm" type="button" data-reinstate="' + esc(x.userId) + '">Allow back</button></li>';
                }).join("") + "</ul>"
              : "") +
          "</section>" +
          '<div class="raffle-detail__side">' +
            '<section class="admin-card"><h2 class="admin-card__title">Winners</h2>' +
              (winners.length
                ? '<ol class="winners-list">' + winners.map(function (w) {
                    return "<li><b>" + esc(w.username) + '</b> <span class="admin-muted">' + esc(w.casinoUsername || "") + "</span><small>" +
                      plural(w.tickets || 0, "ticket", "tickets") + (r.totalTickets ? " · " + ((w.tickets || 0) / r.totalTickets * 100).toFixed(1) + "% chance" : "") + "</small></li>";
                  }).join("") + "</ol>"
                : '<p class="admin-muted">' + (r.state === "open" ? "Drawn after the raffle ends." : s.entries ? "Ready to draw." : "No entries to draw from.") + "</p>") +
              ((r.draws || d.draws || []).length > 1 || (d.draws.length && d.draws[0].redraw)
                ? '<h3 class="admin-subtitle">Draw history</h3><ul class="mini-list">' + d.draws.slice().reverse().map(function (x) {
                    return "<li><b>" + (x.redraw ? "Redraw" : "Draw") + "</b> by " + esc(x.by) + "<small>" + when(x.at) + " · " + money(x.totalTickets) + " tickets · " +
                      x.winners.map(function (w) { return esc(w.username); }).join(", ") + "</small></li>";
                  }).join("") + "</ul>"
                : "") +
            "</section>" +
            '<section class="admin-card"><h2 class="admin-card__title">Activity</h2>' +
              (d.log.length ? '<ul class="mini-list mini-list--log">' + d.log.map(function (l) { return logLine(l, false); }).join("") + "</ul>"
                : '<p class="admin-muted">Nothing yet.</p>') +
            "</section>" +
          "</div>" +
        "</div>";

      panel.querySelector("[data-back]").addEventListener("click", function (e) { e.preventDefault(); go("raffles"); });
      var refresh = panel.querySelector("[data-refresh]");
      if (refresh) refresh.addEventListener("click", load);
      panel.querySelectorAll("[data-act]").forEach(function (b) {
        b.addEventListener("click", function () {
          var a = b.getAttribute("data-act");
          if (a === "csv") return exportCsv(r, list, total);
          act[a]();
        });
      });
      panel.querySelectorAll("[data-remove]").forEach(function (b) {
        b.addEventListener("click", function () {
          var e = list.filter(function (x) { return x.userId === b.getAttribute("data-remove"); })[0];
          formDialog("Remove " + e.username + "?", [
            { name: "reason", label: "Reason (kept in the activity log)", type: "text", placeholder: "e.g. Duplicate account",
              hint: "They lose their entry and can't join this raffle again unless you allow them back." },
          ], "Remove").then(function (v) {
            if (!v) return;
            return R.api("/api/admin/raffles/remove-entry", { id: r.id, userId: e.userId, reason: v.reason }).then(function () { R.toast("Removed."); load(); });
          }).catch(fail);
        });
      });
      panel.querySelectorAll("[data-reinstate]").forEach(function (b) {
        b.addEventListener("click", function () {
          R.api("/api/admin/raffles/reinstate", { id: r.id, userId: b.getAttribute("data-reinstate") }).then(function () {
            R.toast("They can join again."); load();
          }).catch(fail);
        });
      });
    }

    function statTile(n, label) {
      return '<div class="admin-tile admin-tile--static"><span class="admin-tile__n">' + n + '</span><span class="admin-tile__label">' + label + "</span></div>";
    }

    load();
    every(function () {
      if (!panel.querySelector(".admin-live--off") && !document.querySelector("dialog[open]")) load();
    }, 60000);
    every(function () {
      panel.querySelectorAll("[data-countdown]").forEach(function (el) { el.textContent = countdown(el.getAttribute("data-countdown")); });
    }, 1000);
  }

  function exportCsv(r, list, total) {
    var cell = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = [["Kick", CASINO_NAME[r.casino] + " username", "Wagered", "Tickets", "Odds %", "Joined (UTC)"]].concat(list.map(function (e) {
      return [e.username, e.casinoUsername || "", e.wagered == null ? "" : e.wagered, e.tickets == null ? "" : e.tickets,
        total && e.tickets ? (e.tickets / total * 100).toFixed(2) : "", new Date(e.at).toISOString()];
    }));
    var blob = new Blob([rows.map(function (x) { return x.map(cell).join(","); }).join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (r.game + " " + r.prize).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() + "-entries.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function editRaffle(r, after) {
    var x = r || {
      thumb: "wanted", winners: 1, value: 100, casino: "razed", perDollars: 100, ticketsPer: 1, minWager: 0, maxTickets: 0,
      wagerFrom: new Date().toISOString(), endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
    formDialog(r ? "Edit raffle" : "New raffle", [
      { name: "game", label: "Title", type: "text", value: x.game, required: true, placeholder: "e.g. Wanted Dead or a Wild, or $25 Free Balance" },
      { name: "prize", label: "Subtitle (optional)", type: "text", value: x.prize, placeholder: "e.g. $100 Bonus Buy",
        hint: "Shown under the title. Leave empty if the title already says what's won; a subtitle that only repeats the title is hidden." },
      { name: "value", label: "Prize value ($)", type: "number", value: x.value, hint: "Used by the Reward sort." },
      { name: "winners", label: "Number of winners", type: "number", value: x.winners, min: 1 },
      { name: "casino", label: "Casino (where wagers count)", type: "select", value: x.casino, options: CASINOS,
        hint: "Players need an approved link for this casino to join." },
      { name: "perDollars", label: "Every … dollars wagered", type: "number", step: "0.01", min: 0.01, value: x.perDollars, required: true },
      { name: "ticketsPer", label: "… gives this many tickets", type: "number", min: 1, value: x.ticketsPer, required: true,
        hint: "e.g. $100 and 1 ticket: $1,250 wagered = 12 tickets." },
      { name: "minWager", label: "Minimum wager to get tickets ($)", type: "number", step: "0.01", min: 0, value: x.minWager || 0, hint: "0 for none." },
      { name: "maxTickets", label: "Max tickets per player", type: "number", min: 0, value: x.maxTickets || 0, hint: "0 for no cap." },
      { name: "wagerFrom", label: "Wagers count from (your local time)", type: "datetime", value: x.wagerFrom,
        hint: "Until the raffle ends. Razed counts whole UTC days, at most 45." },
      { name: "endsAt", label: "Ends at (your local time)", type: "datetime", value: x.endsAt },
      { name: "thumb", label: "Thumbnail", type: "imagepick", value: x.thumb, options: RAFFLE_THUMBS },
    ], r ? "Save" : "Create raffle").then(function (v) {
      if (!v) return;
      v.id = r ? r.id : undefined;
      return R.api("/api/admin/raffles", { raffle: v }).then(function (d) {
        R.toast(r ? "Saved." : "Raffle created.");
        if (r) return (after || function () { show("raffles"); })();
        go("raffles/" + d.raffle.id);
      });
    }).catch(fail);
  }

  /* ---------------- linked accounts ---------------- */

  var linkFilter = "pending";
  var LINK_PILL = { pending: ["Waiting", "pending"], approved: ["Linked", "done"], rejected: ["Rejected", "refunded"], unlinked: ["Unlinked", "muted"] };

  views.links = function () {
    R.api("/api/admin/links").then(function (d) {
      var all = d.links;
      setLinkBadge(all.filter(function (l) { return l.status === "pending"; }).length);
      var list = all.filter(function (l) {
        return linkFilter === "all" || (linkFilter === "pending" ? l.status === "pending" : l.status === "approved");
      });
      var errs = Object.keys(d.errors || {}).map(function (c) { return CASINO_NAME[c] + ": " + d.errors[c]; });
      panel.innerHTML =
        '<div class="admin-toolbar">' +
          '<div class="seg" role="group" aria-label="Show">' +
            '<button type="button" data-filter="pending" aria-pressed="' + (linkFilter === "pending") + '">Waiting</button>' +
            '<button type="button" data-filter="approved" aria-pressed="' + (linkFilter === "approved") + '">Linked</button>' +
            '<button type="button" data-filter="all" aria-pressed="' + (linkFilter === "all") + '">All</button>' +
          "</div>" +
          '<button class="abtn abtn--primary" type="button" data-manual>+ Link manually</button>' +
          '<p class="admin-muted">Players ask to link their casino username on their profile. Names not under code ' + esc(R.config.code) +
            " are refused automatically; approving checks again. Only approved links earn raffle tickets.</p>" +
        "</div>" +
        (errs.length ? '<p class="admin-muted admin-intro">Couldn\'t load wagers (' + esc(errs.join("; ")) + ").</p>" : "") +
        (list.length ? '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Kick</th><th>Casino</th><th>Username</th><th>Under ' + esc(R.config.code) + '?</th><th>Wagered, last 30 days</th><th>Requested</th><th>Status</th><th></th></tr></thead><tbody>' +
          list.map(function (l) {
            return "<tr><td>" + player(l.kickName, l.avatar) + "</td><td>" + esc(l.casinoName) + "</td><td><b>" + esc(l.username) + "</b></td>" +
              "<td>" + underCode(l) + "</td>" +
              "<td>" + (l.wager30 == null ? "—" : l.wager30 > 0 ? dollars(l.wager30) : '<span class="admin-muted">$0</span>') + "</td>" +
              "<td>" + when(l.requestedAt) + "</td>" +
              '<td><span class="pill pill--' + LINK_PILL[l.status][1] + '">' + LINK_PILL[l.status][0] + "</span>" +
                (l.decidedBy ? '<small class="admin-muted"> by ' + esc(l.decidedBy) + "</small>" : "") + (l.note ? '<small class="admin-muted"> · ' + esc(l.note) + "</small>" : "") + "</td>" +
              '<td class="admin-actions">' +
                (l.status === "pending" || l.status === "approved" ? '<button class="abtn" type="button" data-recheck="' + l.id + '">Re-check</button>' : "") +
                (l.status === "pending" ? '<button class="abtn abtn--ok" type="button" data-approve="' + l.id + '">Approve</button><button class="abtn abtn--danger" type="button" data-reject="' + l.id + '">Reject</button>' : "") +
                (l.status === "approved" ? '<button class="abtn abtn--danger" type="button" data-unlink="' + l.id + '">Unlink</button>' : "") +
              "</td></tr>";
          }).join("") + "</tbody></table></div>"
          : '<p class="admin-empty">' + (linkFilter === "pending" ? "No link requests waiting." : "No linked accounts yet.") + "</p>");

      var find = function (id) { return all.filter(function (l) { return l.id === id; })[0]; };
      panel.querySelectorAll("[data-filter]").forEach(function (b) {
        b.addEventListener("click", function () { linkFilter = b.getAttribute("data-filter"); views.links(); });
      });
      panel.querySelector("[data-manual]").addEventListener("click", manualLink);
      panel.querySelectorAll("[data-approve]").forEach(function (b) {
        b.addEventListener("click", function () {
          var l = find(b.getAttribute("data-approve"));
          R.confirm({
            title: "Approve " + l.username + "?",
            html: "<p>Links <b>" + esc(l.kickName) + "</b> (Kick) to <b>" + esc(l.username) + "</b> on " + esc(l.casinoName) + ". Their wagers under code " +
              esc(R.config.code) + " will earn raffle tickets. It's looked up under the code again first.</p>",
            confirm: "Approve",
          }).then(function (ok) {
            if (ok) return withForce(function (force) { return decideLink(l.id, "approve", "", "Approved.", force); }, "Approve anyway");
          }).catch(fail);
        });
      });
      panel.querySelectorAll("[data-recheck]").forEach(function (b) {
        b.addEventListener("click", function () {
          b.disabled = true;
          b.textContent = "Checking…";
          R.api("/api/admin/links/check", { id: b.getAttribute("data-recheck") }).then(function (d) {
            var v = d.verified;
            R.toast(v.error ? "Couldn't check: " + esc(v.error) : v.found && v.stillUnderCode !== false ? "Found under " + esc(R.config.code) + "." : "Not under " + esc(R.config.code) + ".");
            views.links();
          }).catch(fail).then(function () { b.disabled = false; });
        });
      });
      panel.querySelectorAll("[data-reject]").forEach(function (b) {
        b.addEventListener("click", function () {
          var l = find(b.getAttribute("data-reject"));
          formDialog("Reject " + l.username + "?", [
            { name: "note", label: "Reason (shown to the player)", type: "text", placeholder: "e.g. Not playing under code " + R.config.code, hint: l.kickName + " · " + l.casinoName },
          ], "Reject").then(function (v) {
            if (v) return decideLink(l.id, "reject", v.note, "Rejected.");
          }).catch(fail);
        });
      });
      panel.querySelectorAll("[data-unlink]").forEach(function (b) {
        b.addEventListener("click", function () {
          var l = find(b.getAttribute("data-unlink"));
          formDialog("Unlink " + l.username + "?", [
            { name: "note", label: "Reason (shown to the player)", type: "text", placeholder: "Optional",
              hint: l.kickName + " stops earning tickets, including in raffles they already joined. They can ask to link again." },
          ], "Unlink").then(function (v) {
            if (v) return decideLink(l.id, "unlink", v.note, "Unlinked.");
          }).catch(fail);
        });
      });
    }).catch(fail);
  };

  function decideLink(id, action, note, done, force) {
    // Approving looks the name up under the code again, which can take a few seconds
    if (action === "approve") R.toast("Checking under " + esc(R.config.code) + "…");
    return R.api("/api/admin/links", { id: id, action: action, note: note, force: !!force }).then(function () { R.toast(done); views.links(); });
  }

  /** Is the username under the code? From the last check (at request, approval or Re-check). */
  function underCode(l) {
    var v = l.verified;
    if (!v) return '<span class="admin-muted">Not checked</span>';
    var age = '<small class="admin-muted">checked ' + when(v.at) + "</small>";
    if (v.error) return '<span class="admin-warn">Couldn\'t check</span>' + age;
    if (!v.found) return '<span class="admin-warn">✗ Not found</span>' + (l.approvedAnyway ? ' <span class="admin-muted">(approved anyway)</span>' : "") + age;
    if (v.stillUnderCode === false) return '<span class="admin-warn">✗ Moved to another code</span>' + age;
    return '<span class="admin-ok">✓ Under ' + esc(R.config.code) + "</span>" + age;
  }

  /** Run an action; if the server says the name isn't under the code, offer to do it anyway. */
  function withForce(run, anywayLabel) {
    return run(false).catch(function (err) {
      if (err.code !== "not_under_code") throw err;
      return R.confirm({ title: "Not under " + R.config.code, html: "<p>" + esc(err.message) + "</p>", confirm: anywayLabel, danger: true })
        .then(function (ok) { if (ok) return run(true); });
    });
  }

  function manualLink(prefill) {
    formDialog("Link an account", [
      { name: "kick", label: "Kick username", type: "text", value: prefill && prefill.kick, required: true, hint: "They must have logged in on the site once." },
      { name: "casino", label: "Casino", type: "select", value: "razed", options: CASINOS },
      { name: "username", label: "Casino username", type: "text", required: true },
    ], "Link").then(function (v) {
      if (!v) return;
      return withForce(function (force) {
        R.toast("Checking under " + esc(R.config.code) + "…");
        return R.api("/api/admin/links/manual", Object.assign({}, v, { force: force })).then(function () { R.toast("Linked."); linkFilter = "approved"; show("links"); });
      }, "Link anyway");
    }).catch(fail);
  }

  /* ---------------- messages (contact form) ---------------- */

  var messageFilter = "new";
  var TOPIC = { general: "General", leaderboard: "Leaderboards", raffles: "Raffles", store: "Points Store", account: "Linking", privacy: "Privacy / data" };

  views.messages = function () {
    R.api("/api/admin/messages").then(function (d) {
      var all = d.messages;
      setMessageBadge(all.filter(function (m) { return m.status === "new"; }).length);
      var list = messageFilter === "all" ? all : all.filter(function (m) { return m.status === "new"; });
      panel.innerHTML =
        '<div class="admin-toolbar">' +
          '<div class="seg" role="group" aria-label="Show">' +
            '<button type="button" data-filter="new" aria-pressed="' + (messageFilter === "new") + '">New</button>' +
            '<button type="button" data-filter="all" aria-pressed="' + (messageFilter === "all") + '">All</button>' +
          "</div>" +
          '<p class="admin-muted">From the <a class="accent" href="/contact" target="_blank" rel="noopener">contact form</a>. Reply where they asked, then mark it done.</p>' +
        "</div>" +
        (list.length ? '<div class="admin-items">' + list.map(function (m) {
          return '<article class="amsg' + (m.status === "done" ? " is-done" : "") + '">' +
            '<header class="amsg__head"><b>' + esc(m.reply) + "</b>" + (m.name ? ' <span class="admin-muted">' + esc(m.name) + "</span>" : "") +
              ' <span class="pill pill--' + (m.topic === "privacy" ? "refunded" : "muted") + '">' + esc(TOPIC[m.topic] || m.topic) + "</span>" +
              (m.kick ? ' <span class="admin-muted">Kick: ' + esc(m.kick) + "</span>" : "") +
              '<small class="amsg__when">' + when(m.at) + (m.status === "done" ? " · done by " + esc(m.handledBy || "") : "") + "</small></header>" +
            '<p class="amsg__body">' + esc(m.message).replace(/\n/g, "<br />") + "</p>" +
            '<div class="admin-actions">' +
              '<button class="abtn" type="button" data-copy-reply="' + esc(m.reply) + '">Copy reply address</button>' +
              (m.status === "new" ? '<button class="abtn abtn--ok" type="button" data-msg="done" data-id="' + m.id + '">Mark done</button>'
                : '<button class="abtn" type="button" data-msg="reopen" data-id="' + m.id + '">Reopen</button>') +
              '<button class="abtn abtn--danger" type="button" data-msg="delete" data-id="' + m.id + '">Delete</button>' +
            "</div></article>";
        }).join("") + "</div>"
          : '<p class="admin-empty">' + (messageFilter === "new" ? "No new messages." : "No messages yet.") + "</p>");

      panel.querySelectorAll("[data-filter]").forEach(function (b) {
        b.addEventListener("click", function () { messageFilter = b.getAttribute("data-filter"); views.messages(); });
      });
      panel.querySelectorAll("[data-copy-reply]").forEach(function (b) {
        b.addEventListener("click", function () { R.copyText(b.getAttribute("data-copy-reply")).then(function () { R.toast("Copied."); }); });
      });
      panel.querySelectorAll("[data-msg]").forEach(function (b) {
        b.addEventListener("click", function () {
          var action = b.getAttribute("data-msg");
          var run = function () {
            return R.api("/api/admin/messages", { id: b.getAttribute("data-id"), action: action }).then(function () {
              R.toast({ done: "Marked done.", reopen: "Reopened.", delete: "Deleted." }[action]);
              views.messages();
            });
          };
          (action === "delete"
            ? R.confirm({ title: "Delete this message?", html: "<p>It's removed for good. Use this for spam, or after handling a deletion request.</p>", confirm: "Delete", danger: true })
            : Promise.resolve(true)
          ).then(function (ok) { if (ok) return run(); }).catch(fail);
        });
      });
    }).catch(fail);
  };

  /* ---------------- points ---------------- */

  var pointsName = "";
  views.points = function () {
    Promise.all([
      R.api("/api/admin/points" + (pointsName ? "?name=" + encodeURIComponent(pointsName) : "")),
      R.api("/api/admin/earnings").catch(function () { return null; }),
    ]).then(function (both) {
      var d = both[0], earn = both[1];
      var v = d.viewer;
      panel.innerHTML =
        (earn ? earnCard(earn) : "") +
        '<div class="admin-grid">' +
          '<section class="admin-card"><h2 class="admin-card__title">Look up a viewer</h2>' +
            '<form class="inline-form" data-lookup><input name="name" type="text" placeholder="Kick username" value="' + esc(pointsName) + '" required />' +
            '<button class="abtn abtn--primary" type="submit">Look up</button></form>' +
            (pointsName ? (v
              ? '<div class="viewer"><b>' + esc(v.name) + '</b><span><img src="/assets/store/coin.webp" alt="" width="18" height="18" />' + money(v.points) + " points</span><small>" +
                money(Math.round(v.watchtime / 60)) + " hours watched</small></div>" +
                '<form class="inline-form" data-adjust><input name="delta" type="number" step="1" placeholder="+500 or -500" required />' +
                '<input name="reason" type="text" placeholder="Reason (optional)" /><button class="abtn abtn--ok" type="submit">Apply</button></form>'
              : '<p class="admin-muted">BotRix doesn\'t know <b>' + esc(pointsName) + "</b> on this channel yet.</p>") : "") +
          "</section>" +
          '<section class="admin-card"><h2 class="admin-card__title">Recent changes</h2>' +
            (d.log.length ? '<ul class="mini-list">' + d.log.map(function (l) {
              return '<li><b class="' + (l.delta > 0 ? "plus" : "minus") + '">' + (l.delta > 0 ? "+" : "") + money(l.delta) + "</b> " + esc(l.name) +
                " <small>" + esc(l.reason || "") + " · by " + esc(l.by) + " · " + when(l.at) + "</small></li>";
            }).join("") + "</ul>" : '<p class="admin-muted">No point changes from the site yet.</p>') +
          "</section>" +
        "</div>";

      var run = panel.querySelector("[data-earn-run]");
      if (run) run.addEventListener("click", function () {
        run.disabled = true;
        run.textContent = "Crediting…";
        R.api("/api/admin/earnings/run", {}).then(function (r) {
          var s = r.summary;
          R.toast(s.points ? "Paid " + money(s.points) + " points to " + money(s.paid) + " player" + (s.paid === 1 ? "" : "s") + "." : "Nobody was owed anything right now.");
          views.points();
        }).catch(fail).then(function () { run.disabled = false; run.textContent = "Credit now"; });
      });
      panel.querySelector("[data-lookup]").addEventListener("submit", function (e) {
        e.preventDefault();
        pointsName = e.target.name.value.trim();
        views.points();
      });
      var adjust = panel.querySelector("[data-adjust]");
      if (adjust) adjust.addEventListener("submit", function (e) {
        e.preventDefault();
        var delta = Math.round(Number(e.target.delta.value));
        if (!delta) return;
        R.confirm({
          title: (delta > 0 ? "Add " : "Take ") + money(Math.abs(delta)) + " points?",
          html: "<p>" + (delta > 0 ? "Adds to " : "Takes from ") + "<b>" + esc(v.name) + "</b>'s BotRix balance (now " + money(v.points) + ").</p>",
          confirm: delta > 0 ? "Add points" : "Take points", danger: delta < 0,
        }).then(function (ok) {
          if (!ok) return;
          return R.api("/api/admin/points", { name: v.name, delta: delta, reason: e.target.reason.value }).then(function () {
            R.toast("Done."); views.points();
          });
        }).catch(fail);
      });
    }).catch(fail);
  };

  function earnCard(e) {
    var rules = Object.keys(e.rules || {}).map(function (c) {
      return esc(CASINO_NAME[c] || c) + ": " + money(e.rules[c].points) + " points per " + dollars(e.rules[c].per) + " wagered";
    }).join(" · ") || "No wager rules set (content.js → earn.wager).";
    var last = e.lastRun;
    return '<section class="admin-card admin-earn"><h2 class="admin-card__title">Wager points <span class="admin-muted">' + rules + "</span></h2>" +
      '<p class="admin-muted">Paid automatically into BotRix for approved links, per calendar month, counted from the day the link was approved: when a player opens their profile or the store, ' +
        (e.cron ? "and every day at 06:00 UTC." : "and daily once <b>CRON_SECRET</b> is set in Vercel.") + "</p>" +
      '<div class="admin-toolbar admin-toolbar--tight"><button class="abtn abtn--primary" type="button" data-earn-run>Credit now</button>' +
        '<span class="admin-muted">' + (last ? "Last run " + when(last.at) + " by " + esc(last.by) + ": " + money(last.points) + " points to " + money(last.paid) + " of " + money(last.players) + " players" +
          (last.problems && last.problems.length ? ' · <span class="admin-warn">' + money(last.problems.length) + " problem(s): " + esc(last.problems.slice(0, 2).join("; ")) + "</span>" : "") : "Not run yet.") + "</span></div>" +
      (e.players.length ? '<ul class="mini-list">' + e.players.slice(0, 8).map(function (p) {
        var m = p.months.slice().sort(function (a, b) { return a.slot < b.slot ? 1 : -1; })[0] || {};
        return "<li><b>" + esc(p.kickName) + "</b> " + money(p.credited) + " points in total<small>" + (m.slot ? esc(m.slot.replace(":", " ")) + ": " + dollars(m.wagered || 0) + " wagered, " + money(m.credited || 0) + " points" : "") + "</small></li>";
      }).join("") + "</ul>" : '<p class="admin-muted">Nobody has earned wager points yet.</p>') +
    "</section>";
  }

  /* ---------------- players ---------------- */

  views.players = function () {
    R.api("/api/admin/users").then(function (d) {
      panel.innerHTML = d.users.length
        ? '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Player</th><th>Linked</th><th>First signed in</th><th>Last seen</th><th>Orders</th><th></th></tr></thead><tbody>' +
          d.users.map(function (u) {
            var linked = (u.links || []).map(function (l) { return esc(CASINO_NAME[l.casino]) + ": <b>" + esc(l.username) + "</b>"; }).join("<br />");
            return "<tr><td>" + player(u.username, u.avatar) + "</td><td>" + (linked || '<span class="admin-muted">—</span>') + "</td><td>" + when(u.createdAt) + "</td><td>" + when(u.lastSeen) + "</td><td>" + money(u.orders) + "</td>" +
              '<td class="admin-actions"><button class="abtn" type="button" data-link-user="' + esc(u.username) + '">Link</button>' +
              '<button class="abtn" type="button" data-points="' + esc(u.username) + '">Points</button></td></tr>';
          }).join("") + "</tbody></table></div>"
        : '<p class="admin-empty">Nobody has signed in yet.</p>';
      panel.querySelectorAll("[data-points]").forEach(function (b) {
        b.addEventListener("click", function () { pointsName = b.getAttribute("data-points"); show("points"); });
      });
      panel.querySelectorAll("[data-link-user]").forEach(function (b) {
        b.addEventListener("click", function () { manualLink({ kick: b.getAttribute("data-link-user") }); });
      });
    }).catch(fail);
  };

  /* ---------------- overlays ---------------- */

  var OVERLAYS = [
    { path: "/overlay/leaderboard?board=razed", name: "Leaderboard · Razed", size: "460 × 640", note: "Live top 10, prize pool and countdown. Use board=razedio for Razed.IO, and &top=5 for a shorter list." },
    { path: "/overlay/leaderboard?board=razedio", name: "Leaderboard · Razed.IO", size: "460 × 420", note: "Same, for the Razed.IO board." },
    { path: "/overlay/raffle", name: "Raffle", size: "520 × 260", note: "The next raffle to end with its ticket rule and entry count; shows the winners for 10 minutes after you draw." },
    { path: "/overlay/alerts", name: "Store alerts", size: "520 × 140", note: "Pops up when someone buys from the Points Store. Transparent until then." },
  ];

  views.overlays = function () {
    var origin = location.origin;
    panel.innerHTML =
      '<p class="admin-muted admin-intro">Add each one in OBS as a <b>Browser Source</b> with the size shown. They have a transparent background and update by themselves.</p>' +
      '<div class="admin-grid">' + OVERLAYS.map(function (o, i) {
        var url = origin + o.path;
        return '<section class="admin-card"><h2 class="admin-card__title">' + esc(o.name) + ' <span class="admin-muted">' + o.size + "</span></h2>" +
          '<p class="admin-muted">' + esc(o.note) + "</p>" +
          '<code class="admin-url">' + esc(url) + "</code>" +
          '<div class="admin-actions"><button class="abtn abtn--primary" type="button" data-copy-url="' + esc(url) + '">Copy link</button>' +
          '<button class="abtn" type="button" data-preview="' + i + '">Preview</button>' +
          '<a class="abtn" href="' + esc(o.path) + '" target="_blank" rel="noopener">Open</a></div>' +
          '<div class="overlay-preview" data-preview-box="' + i + '" hidden></div></section>';
      }).join("") + "</div>";

    panel.querySelectorAll("[data-copy-url]").forEach(function (b) {
      b.addEventListener("click", function () {
        R.copyText(b.getAttribute("data-copy-url")).then(function () { R.toast("Link copied."); }, function () { R.toast(esc(b.getAttribute("data-copy-url"))); });
      });
    });
    panel.querySelectorAll("[data-preview]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = b.getAttribute("data-preview");
        var box = panel.querySelector('[data-preview-box="' + i + '"]');
        box.hidden = !box.hidden;
        b.textContent = box.hidden ? "Preview" : "Hide preview";
        box.innerHTML = box.hidden ? "" : '<iframe src="' + esc(OVERLAYS[i].path) + (OVERLAYS[i].path.indexOf("alerts") >= 0 ? "?demo=1" : "") + '" title="' + esc(OVERLAYS[i].name) + ' preview"></iframe>';
      });
    });
  };

  /* ---------------- start ---------------- */

  R.me(true).then(function (me) {
    if (!me.user) {
      who.innerHTML = 'Sign in with an admin Kick account. <a class="accent" href="' + R.loginUrl("/admin") + '">Log in with Kick</a>';
      return;
    }
    if (!me.admin) {
      who.textContent = "Signed in as " + me.user.username + ", which isn't an admin account.";
      return;
    }
    who.textContent = "Signed in as " + me.user.username;
    tabs.hidden = false;
    // Badges for waiting orders and link requests, whichever tab opens first
    refreshBadges();
    var start = (location.hash || "").slice(1);
    if (views[start.split("/")[0]]) go(start); else show("overview");
    // Back/forward and pasted links like #raffles/<id>
    window.addEventListener("hashchange", function () {
      var h = (location.hash || "").slice(1);
      if (h !== current + (currentSub ? "/" + currentSub : "") && views[h.split("/")[0]]) go(h);
    });
  });
})();
