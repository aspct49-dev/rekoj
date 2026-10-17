/*
 * Copies partials/header.html and partials/footer.html into every page.
 *
 *   node tools/sync-layout.js
 *
 * Each page marks where they go:
 *   <!-- layout:header --> … <!-- /layout:header -->
 *   <!-- layout:footer --> … <!-- /layout:footer -->
 *
 * The site stays plain static files (nothing to build on Vercel); run this
 * after editing a partial and commit the result. Which nav item is active is
 * decided by <body data-page="…">, so the header is identical on every page.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const partials = {
  header: fs.readFileSync(path.join(root, "partials/header.html"), "utf8").replace(/\s+$/, ""),
  footer: fs.readFileSync(path.join(root, "partials/footer.html"), "utf8").replace(/\s+$/, ""),
};

let changed = 0;
for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".html"))) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, "utf8");
  let after = before;
  for (const [name, html] of Object.entries(partials)) {
    const re = new RegExp(String.raw`(<!-- layout:${name} -->)[\s\S]*?(\s*<!-- /layout:${name} -->)`);
    after = after.replace(re, (m, open, close) => `${open}\n${html}\n  ${close.trim()}`);
  }
  if (after !== before) {
    fs.writeFileSync(full, after);
    changed++;
    console.log("updated", file);
  }
}
console.log(changed ? `${changed} page(s) updated` : "all pages already in sync");
