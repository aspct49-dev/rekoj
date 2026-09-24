/*
 * Local preview server: static files plus the /api routes.
 *
 *   node dev-server.js          then open http://127.0.0.1:5173
 *
 * Reads .env.local (gitignored) so the leaderboard proxy has its key, the same
 * way Vercel reads the project's environment variables in production. Use this
 * or `npx vercel dev`; a plain static server has no /api routes, and the page
 * then falls back to the sample entries in data.js.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 5173;
const ROOT = __dirname;

// .env.local -> process.env (existing values win, as on Vercel)
try {
  const text = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (err) {
  console.warn("No .env.local found — the leaderboard will use the fallback entries.");
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://" + (req.headers.host || "127.0.0.1"));

    if (url.pathname.startsWith("/api/")) {
      const file = path.join(ROOT, url.pathname + ".js");
      if (!fs.existsSync(file)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end('{"error":"No such API route"}');
      }
      delete require.cache[require.resolve(file)]; // pick up edits without a restart
      const handler = require(file);
      req.query = Object.fromEntries(url.searchParams);
      try {
        return await handler(req, res);
      } catch (err) {
        console.error(err);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end('{"error":"Handler threw"}');
      }
    }

    // Static files, with Vercel's cleanUrls behaviour (/terms -> terms.html).
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    let file = path.join(ROOT, rel);
    if (!path.resolve(file).startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const notFound = path.join(ROOT, "404.html");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : "Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log("RekoJ dev server on http://127.0.0.1:" + PORT);
  });
