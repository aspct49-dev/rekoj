/*
 * Contact form: checks the fields the same way the server does (server/api.js
 * cleanMessage), sends to POST /api/contact, and only says "sent" when the
 * server confirms the message was stored or forwarded.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var form = document.getElementById("contactForm");
  var done = document.getElementById("contactDone");
  var errorBox = document.getElementById("contactError");
  if (!form) return;
  var send = form.querySelector(".contact__send");
  var count = document.getElementById("c_message_count");
  var startedAt = Date.now();

  var EMAILISH = /@.*\./;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function fieldError(input, message) {
    input.setAttribute("aria-invalid", message ? "true" : "false");
    var row = input.closest(".contact__row");
    var el = row.querySelector(".contact__field-error");
    if (!message) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("small");
      el.className = "contact__field-error";
      el.id = input.id + "_error";
      row.appendChild(el);
      input.setAttribute("aria-describedby", (input.getAttribute("aria-describedby") || "") + " " + el.id);
    }
    el.textContent = message;
  }

  function validate() {
    var reply = form.reply.value.trim();
    var message = form.message.value.trim();
    var problems = [];
    var replyErr = reply.length < 2 ? "Tell us how to reply: a Kick or Discord username, or an email address."
      : EMAILISH.test(reply) && !EMAIL.test(reply) ? "That email address doesn't look right." : "";
    var messageErr = message.length < 10 ? "Tell us a little more (10 characters or more)."
      : message.length > 2000 ? "Please keep it under 2,000 characters." : "";
    fieldError(form.reply, replyErr);
    fieldError(form.message, messageErr);
    if (replyErr) problems.push(form.reply);
    if (messageErr) problems.push(form.message);
    return problems;
  }

  function showError(text) {
    errorBox.textContent = text || "";
    errorBox.hidden = !text;
  }

  form.message.addEventListener("input", function () {
    var n = form.message.value.length;
    count.textContent = R.money(n, 0) + " / 2,000";
    count.classList.toggle("is-over", n > 2000);
  });
  // Clear a field's error as soon as it's fixed
  [form.reply, form.message].forEach(function (input) {
    input.addEventListener("input", function () { if (input.getAttribute("aria-invalid") === "true") validate(); });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    showError("");
    var problems = validate();
    if (problems.length) { problems[0].focus(); return; }
    send.disabled = true;
    send.textContent = "Sending…";
    R.api("/api/contact", {
      name: form.name.value.trim(),
      reply: form.reply.value.trim(),
      topic: form.topic.value,
      message: form.message.value.trim(),
      website: form.website.value,
      startedAt: startedAt,
    }).then(function () {
      done.querySelector("[data-reply]").textContent = form.reply.value.trim();
      form.hidden = true;
      done.hidden = false;
      done.focus();
    }).catch(function (err) {
      // No status means the request never reached us (offline, blocked)
      showError(err && err.status ? err.message : "We couldn't reach the server. Check your connection and try again; your message is still here.");
    }).then(function () {
      send.disabled = false;
      send.textContent = "Send message";
    });
  });

  done.querySelector("[data-another]").addEventListener("click", function () {
    form.reset();
    count.textContent = "0 / 2,000";
    startedAt = Date.now();
    done.hidden = true;
    form.hidden = false;
    form.reply.focus();
  });

  // Logged in: suggest their Kick username as the reply address
  R.me().then(function (me) {
    if (me && me.user && !form.reply.value) form.reply.value = me.user.username + " (Kick)";
  }, function () {});
})();
