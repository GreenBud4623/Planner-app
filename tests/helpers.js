// Shared helpers for the Planner test suite.
// Runs www/ in a phone-sized Chromium with a fake Android bridge (notifications, files, haptics...),
// and a fixed clock so every test sees the same "now": Friday 27 November 2026, 13:00.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { before, after } = require("node:test");
const { chromium, devices } = require("playwright");

const WWW = path.join(__dirname, "..", "www");
const NOW = new Date("2026-11-27T13:00:00+02:00"); // a Friday
const TIMEZONE = "Europe/Bucharest";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

/** Serves www/ on a free local port. */
function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(WWW, rel);
    if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Stand-in for the Android side of Capacitor. Records calls in window.__calls, scheduled notifications in
// window.__scheduled, files in window.__fs (kept in localStorage so they survive reloads).
const FAKE_ANDROID = `
(() => {
  window.__calls = [];
  const listeners = {};
  window.__fs = JSON.parse(localStorage.getItem("__fs") || "{}");
  const persist = () => localStorage.setItem("__fs", JSON.stringify(window.__fs));
  const impl = {
    LocalNotifications: {
      checkPermissions: async () => ({ display: "granted" }),
      requestPermissions: async () => ({ display: "granted" }),
      getPending: async () => ({ notifications: (window.__scheduled || []).map((n) => ({ id: n.id })) }),
      schedule: async (o) => { window.__scheduled = o.notifications; return {}; },
      cancel: async () => { window.__scheduled = []; },
    },
    Filesystem: {
      checkPermissions: async () => ({ publicStorage: localStorage.getItem("__perm") || "granted" }),
      writeFile: async (o) => { window.__fs[o.directory + "/" + o.path] = o.data; persist(); return { uri: "file:///" + o.path }; },
      readdir: async (o) => ({ files: Object.keys(window.__fs).filter((k) => k.startsWith(o.directory + "/" + o.path + "/")).map((k) => ({ name: k.split("/").pop() })) }),
      deleteFile: async (o) => { delete window.__fs[o.directory + "/" + o.path]; persist(); },
    },
  };
  window.Capacitor = {
    isNativePlatform: () => true,
    registerPlugin: (name) => new Proxy({}, { get: (_, m) => (...a) => {
      window.__calls.push(name + "." + m);
      if (m === "addListener") { listeners[name + ":" + a[0]] = a[1]; return Promise.resolve({ remove() {} }); }
      if (window.__plugins && window.__plugins[name] && window.__plugins[name][m]) return window.__plugins[name][m](...a);
      return impl[name] && impl[name][m] ? impl[name][m](...a) : Promise.resolve({});
    } }),
  };
  window.__fire = (key, arg) => listeners[key] && listeners[key](arg);
})();
`;

/**
 * Opens the app on a phone. `data` (optional) is put in storage first, like an existing install.
 * `native: false` runs it as the plain web version instead of the Android app.
 */
async function openApp(browser, { data, native = true, settings, extraScript } = {}) {
  const context = await browser.newContext({ ...devices["Pixel 7"], timezoneId: TIMEZONE });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.clock.install({ time: NOW });
  await page.route("**/vendor/capacitor.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: native ? FAKE_ANDROID + (extraScript || "") : "" }));
  await page.goto(globalThis.__plannerBase);
  if (data || settings) {
    await page.evaluate(({ data, settings }) => {
      if (data) localStorage.setItem("planner.v1", JSON.stringify(data));
      if (settings) localStorage.setItem("planner.settings", JSON.stringify(settings));
    }, { data, settings });
    await page.reload();
  }
  await page.waitForTimeout(600); // the homework popup opens 0.4 s after start
  page.errors = errors;
  return page;
}

/** Saved app data, as stored on the device. */
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("planner.v1") || "{}"));
/** Notifications the app has scheduled with the (fake) phone. */
const scheduled = (page) => page.evaluate(() => (window.__scheduled || []).map((n) => ({
  ...n, at: n.schedule.at ? new Date(n.schedule.at).getTime() : null })));
/** Waits for the app's debounced notification sync. */
const settle = (page) => page.waitForTimeout(500);

/** Sets up a browser + server once per test file. */
function useApp() {
  let browser, server;
  before(async () => {
    server = await startServer();
    globalThis.__plannerBase = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch();
  });
  after(async () => { await browser?.close(); server?.close(); });
  return { open: (opts) => openApp(browser, opts) };
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** ISO date `n` days from the fixed "today" (2026-11-27). */
const day = (n) => iso(new Date(NOW.getTime() + n * 864e5));

module.exports = { NOW, useApp, stored, scheduled, settle, day, iso };
