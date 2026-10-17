/*
 * Shared behaviour for every page: the toast, copy-the-code buttons, the
 * Login button, the footer year, and the helpers the page scripts share.
 *
 * Loaded before any page script; exposes window.Rekoj.
 */
(function () {
  "use strict";

  var config = window.REKOJ_CONFIG || { code: "REKOJ", maskNames: true };

  /*
   * Google Analytics 4 measurement ID, e.g. "G-ABC123XYZ9" (GA → Admin → Data
   * streams). Empty = analytics off: no banner, no Google tag, no cookies.
   * When set, GA loads only after the visitor accepts it in the consent banner.
   */
  var GA4_ID = "";

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

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

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  /** "5D 9H 32M 51S" until `endsAt`; null once it has passed. */
  function shortCountdown(endsAt) {
    var s = Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000);
    if (!(s > 0)) return null;
    return Math.floor(s / 86400) + "D " + Math.floor((s % 86400) / 3600) + "H " +
      Math.floor((s % 3600) / 60) + "M " + (s % 60) + "S";
  }

  /* ---------------- toast ---------------- */

  var toastTimer;
  function toast(html) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.innerHTML = html;
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-visible"); }, 2200);
  }

  /* ---------------- clipboard ---------------- */

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

  // Any element with [data-copy] copies the referral code when clicked.
  function initCopyButtons() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-copy]");
      if (!btn) return;
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

  /* ---------------- podium card ---------------- */

  /**
   * One top-3 card, as on the leaderboard. The Home page's teaser uses the
   * same markup at 81.5% scale, so the two can never drift apart.
   *   o.place  1 | 2 | 3       o.box     card art
   *   o.entry  { name, wagered } o.gift  gift icon
   *   o.avatar image            o.prize   number
   */
  /** o.lazy: the card sits below the first screen (home teaser), so its images can wait */
  function podiumCard(o) {
    var e = o.entry || {};
    var lazy = o.lazy ? ' loading="lazy" decoding="async"' : "";
    var w = Number(e.wagered) || 0;
    return (
      '<article class="card card--' + o.place + '" aria-label="Place ' + o.place + '">' +
        '<img class="card__box" src="' + esc(o.box) + '" alt="" width="281" height="349"' + lazy + " />" +
        '<div class="card__details">' +
          '<div class="card__avatar">' +
            '<div class="card__avatar-img"><img src="' + esc(o.avatar) + '" alt=""' + lazy + " /></div>" +
            '<span class="card__place">' + o.place + "</span>" +
          "</div>" +
          '<p class="card__name grad-text">' + esc(maskName(e.name)) + "</p>" +
          '<div class="card__wager">' +
            '<span class="card__wager-label grad-text">Wagered</span>' +
            '<span class="card__wager-amount grad-text">$' + money(w, w >= 10000 ? 0 : 2) + "</span>" +
          "</div>" +
          '<p class="card__prize"><span class="d">$</span>' + money(o.prize, 0) + "</p>" +
          '<div class="card__tag"><img src="' + esc(o.gift) + '" alt=""' + lazy + ' /><span class="grad-text">Prize</span></div>' +
        "</div>" +
      "</article>"
    );
  }

  /* ---------------- leaderboard data ---------------- */

  /** Entries for a board from its API, falling back to data.js. */
  function loadBoard(key) {
    var board = config.boards && config.boards[key];
    if (!board) return Promise.resolve([]);
    if (!board.apiUrl) return Promise.resolve(board.entries || []);
    return fetch(board.apiUrl, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var entries = Array.isArray(json) ? json : json.entries || [];
        return entries.length ? entries : board.entries || [];
      })
      .catch(function (err) {
        console.warn("[rekoj] Failed to load " + key + " leaderboard, using static data.", err);
        return board.entries || [];
      });
  }

  /* ---------------- count-up ---------------- */

  /**
   * Numbers with [data-count-to] count up from zero the first time they
   * scroll into view: <p data-count-to="100000" data-prefix="$" data-suffix="+">.
   * The real figure stays in the HTML for search engines and no-JS visitors.
   */
  function initCountUps() {
    var els = document.querySelectorAll("[data-count-to]");
    if (!els.length) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function label(el, n) {
      return (el.getAttribute("data-prefix") || "") + money(n, 0) + (el.getAttribute("data-suffix") || "");
    }

    function run(el) {
      var target = Number(el.getAttribute("data-count-to")) || 0;
      var duration = 1800;
      var start = null;
      function frame(now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 4); // fast start, gentle landing
        el.textContent = label(el, Math.round(target * eased));
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    if (reduce || !("IntersectionObserver" in window)) return; // keep the static figure

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        run(entry.target);
      });
    }, { threshold: 0.5 });

    Array.prototype.forEach.call(els, function (el) {
      el.textContent = label(el, 0);
      io.observe(el);
    });
  }

  /* ---------------- API + account ---------------- */

  /** fetch() for our API: JSON in and out; throws Error(message) on failure. */
  function api(path, body) {
    var opts = { headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (body !== undefined) {
      opts.method = "POST";
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Something went wrong. Please try again.");
          err.status = res.status;
          if (data.code) err.code = data.code;
          throw err;
        }
        return data;
      });
    });
  }

  function loginUrl(returnTo) {
    return "/api/auth/kick/login?return=" + encodeURIComponent(returnTo || location.pathname + location.search);
  }

  /** Send the visitor to Kick and bring them back here afterwards. */
  function login(returnTo) { location.href = loginUrl(returnTo); }

  var mePromise = null;
  /** { user, admin, points } — user is null when signed out. Cached per page. */
  function me(refresh) {
    if (!mePromise || refresh) {
      mePromise = api("/api/me").catch(function () { return { user: null, offline: true }; });
    }
    return mePromise;
  }

  function pointsText(points) { return points ? money(points.points, 0) : "—"; }

  function renderAccount(data) {
    var loginBtn = document.querySelector("[data-login]");
    var box = document.querySelector("[data-account]");
    if (!box || !loginBtn) return;
    if (!data.user) {
      box.hidden = true;
      loginBtn.hidden = false;
      return;
    }
    var u = data.user;
    loginBtn.hidden = true;
    box.hidden = false;
    var avatar = box.querySelector(".account__avatar");
    avatar.src = u.avatar || "/assets/shared/rekoj-logo.webp";
    avatar.onerror = function () { avatar.onerror = null; avatar.src = "/assets/shared/rekoj-logo.webp"; };
    box.querySelector(".account__name").textContent = u.username;
    box.querySelector("[data-points]").textContent = pointsText(data.points);
    box.querySelector("[data-admin-link]").hidden = !data.admin;
  }

  /** Re-read points (after spending) and update the chip. */
  function refreshPoints() {
    return me(true).then(function (data) { renderAccount(data); return data; });
  }

  function initAccount() {
    var loginBtn = document.querySelector("[data-login]");
    if (loginBtn) loginBtn.href = loginUrl();

    var box = document.querySelector("[data-account]");
    if (box) {
      var chip = box.querySelector(".account__chip");
      var menu = box.querySelector(".account__menu");
      var close = function () { menu.hidden = true; chip.setAttribute("aria-expanded", "false"); };
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = menu.hidden;
        menu.hidden = !open;
        chip.setAttribute("aria-expanded", String(open));
      });
      document.addEventListener("click", function (e) { if (!box.contains(e.target)) close(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
      box.querySelector("[data-logout]").addEventListener("click", function () {
        api("/api/auth/logout", {}).finally(function () { location.reload(); });
      });
    }

    // Kick sent the visitor back with a problem
    var params = new URLSearchParams(location.search);
    if (params.get("auth_error")) {
      toast(esc(params.get("auth_error")));
      params.delete("auth_error");
      var q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    }

    // Pages without the account chip (overlays) don't need to ask
    if (loginBtn || box) me().then(renderAccount);
  }

  /* ---------------- dialog ---------------- */

  /**
   * A small confirm dialog in the site's style. Resolves true/false.
   *   { title, html, confirm: "Buy", cancel: "Cancel", danger: false }
   */
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog");
      d.className = "dialog";
      d.innerHTML =
        '<form method="dialog" class="dialog__box">' +
          '<h2 class="dialog__title">' + esc(o.title || "") + "</h2>" +
          '<div class="dialog__body">' + (o.html || "") + "</div>" +
          '<div class="dialog__actions">' +
            (o.cancel === false ? "" : '<button class="dialog__btn" value="cancel" type="submit">' + esc(o.cancel || "Cancel") + "</button>") +
            '<button class="dialog__btn dialog__btn--primary' + (o.danger ? " dialog__btn--danger" : "") + '" value="ok" type="submit">' + esc(o.confirm || "OK") + "</button>" +
          "</div>" +
        "</form>";
      document.body.appendChild(d);
      d.addEventListener("close", function () {
        resolve(d.returnValue === "ok");
        setTimeout(function () { d.remove(); }, 200);
      });
      d.addEventListener("click", function (e) { if (e.target === d) d.close("cancel"); });
      d.showModal();
      var primary = d.querySelector(".dialog__btn--primary");
      if (primary) primary.focus();
    });
  }

  /* ---------------- analytics (opt-in) ---------------- */

  var CONSENT_KEY = "rekoj-consent";
  function readConsent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  function saveConsent(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch (e) { /* private mode: ask again next time */ } }
  var analyticsOn = /^G-[A-Z0-9]{4,}$/.test(GA4_ID) &&
    !document.documentElement.classList.contains("is-overlay") && document.body && document.body.getAttribute("data-page") !== "admin";

  function loadAnalytics() {
    if (window.gtag || !analyticsOn) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    // One page_view per page load (this is a multi-page site, so no manual page_view)
    window.gtag("config", GA4_ID);
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
  }

  function consentBanner() {
    if (document.getElementById("consent")) return;
    var box = document.createElement("div");
    box.className = "consent";
    box.id = "consent";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Analytics consent");
    box.innerHTML =
      '<p class="consent__text">Can we use Google Analytics to count visits and see which pages are used? It sets cookies only if you accept. ' +
        '<a href="/privacy">Privacy Policy</a></p>' +
      '<div class="consent__actions"><button class="btn btn--dark consent__btn" type="button" data-consent="denied">Decline</button>' +
        '<button class="btn consent__btn consent__btn--yes" type="button" data-consent="granted">Accept</button></div>';
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-consent]");
      if (!b) return;
      var v = b.getAttribute("data-consent");
      saveConsent(v);
      box.remove();
      if (v === "granted") loadAnalytics();
    });
    document.body.appendChild(box);
  }

  function initConsent() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-consent-reset]"), function (b) {
      b.addEventListener("click", function () {
        if (!analyticsOn) return toast("Analytics isn't switched on for this site, so there's nothing to choose.");
        var was = readConsent();
        try { localStorage.removeItem(CONSENT_KEY); } catch (e) { /* ignore */ }
        // Withdrawing consent: the tag is already loaded this visit, so reload without it
        if (was === "granted") { location.reload(); return; }
        consentBanner();
      });
    });
    if (!analyticsOn) return;
    var c = readConsent();
    if (c === "granted") loadAnalytics();
    else if (c !== "denied") consentBanner();
  }

  /* ---------------- page chrome ---------------- */

  function init() {
    initConsent();
    Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (n) {
      n.textContent = new Date().getFullYear();
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-code]"), function (n) {
      n.textContent = config.code;
    });

    // Referral links come from data.js, so they live in one place.
    Array.prototype.forEach.call(document.querySelectorAll("[data-visit]"), function (a) {
      var board = config.boards && config.boards[a.getAttribute("data-visit")];
      if (board && board.visitUrl) a.href = board.visitUrl;
    });

    // Mark the current page in the nav for assistive tech; the styling comes
    // from <body data-page>.
    var page = document.body.getAttribute("data-page");
    Array.prototype.forEach.call(document.querySelectorAll(".nav__item"), function (a) {
      if (a.getAttribute("data-nav") === page) a.setAttribute("aria-current", "page");
    });

    initCopyButtons();
    initCountUps();
    initAccount();

    // Features that need accounts (Login, Purchase, Join) or pages not built yet say so instead of
    // silently doing nothing.
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-soon]");
      if (!btn) return;
      e.preventDefault();
      toast(btn.getAttribute("data-soon") || "Accounts are coming soon.");
    });
  }

  window.Rekoj = {
    config: config,
    esc: esc,
    money: money,
    maskName: maskName,
    pad: pad,
    shortCountdown: shortCountdown,
    toast: toast,
    copyText: copyText,
    podiumCard: podiumCard,
    loadBoard: loadBoard,
    api: api,
    me: me,
    login: login,
    loginUrl: loginUrl,
    refreshPoints: refreshPoints,
    confirm: confirmDialog,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
