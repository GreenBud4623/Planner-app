// Planner for Windows: runs the same app as Android (../www) in its own window.
// Data is kept in this PC's user profile (%APPDATA%\Planner). Nothing is sent anywhere.
// Closing the window keeps Planner in the system tray so reminders still arrive.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, nativeTheme, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { dueBetween, stillPending } = require("./scheduler");

const APP_ID = "app.planner.local";
const ICON = path.join(__dirname, "www", "icons", "icon-512.png");
const TICK_MS = 15 * 1000;
const MAX_LATE_MS = 15 * 60 * 1000; // after sleep, still show reminders up to 15 minutes late

let win = null;
let tray = null;
let quitting = false;
let trayHintShown = false;
let scheduled = []; // Capacitor-style notification objects from www/app.js
let lastTick = Date.now();
const live = new Set(); // keep shown notifications alive so their click handler works

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(start);
}

app.setAppUserModelId(APP_ID); // needed for Windows notifications to show the app's name

// ---------- Window ----------
const boundsFile = () => path.join(app.getPath("userData"), "window.json");

function loadBounds() {
  try { return JSON.parse(fs.readFileSync(boundsFile(), "utf8")); } catch { return {}; }
}

function saveBounds() {
  if (!win || win.isMinimized() || win.isMaximized()) return;
  try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds())); } catch { /* not important */ }
}

function createWindow(showNow) {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b.width || 480,
    height: b.height || 860,
    x: b.x, y: b.y,
    minWidth: 360,
    minHeight: 560,
    show: false,
    title: "Planner",
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1712" : "#f4f8f5",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "www", "index.html"));
  if (showNow) win.once("ready-to-show", () => win.show());

  // Links open in the normal browser; the app window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:")) e.preventDefault();
  });

  // "Save a backup file": suggest Documents\Planner\planner-backup-<date>.json
  win.webContents.session.on("will-download", (_e, item) => {
    const dir = path.join(app.getPath("documents"), "Planner");
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* the dialog still works */ }
    item.setSaveDialogOptions({
      title: "Save a Planner backup",
      defaultPath: path.join(dir, item.getFilename()),
      filters: [{ name: "Planner backup", extensions: ["json"] }],
    });
  });

  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault(); // keep running in the tray so reminders still arrive
    win.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      show({ title: "Planner is still running", body: "It stays in the tray to send your reminders. Right-click the tray icon to quit." });
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- Tray ----------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
  tray.setToolTip("Planner");
  tray.on("click", showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  const startsWithWindows = app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Planner", click: showWindow },
    { type: "separator" },
    {
      label: "Start with Windows (for reminders)",
      type: "checkbox",
      checked: startsWithWindows,
      enabled: app.isPackaged,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
        refreshTrayMenu();
      },
    },
    { type: "separator" },
    { label: "Quit Planner", click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- Notifications ----------
function show({ title, body }, onClick) {
  const n = new Notification({ title, body, icon: ICON });
  live.add(n);
  const forget = () => live.delete(n);
  n.on("click", () => { forget(); if (onClick) onClick(); });
  n.on("close", forget);
  n.on("failed", forget);
  n.show();
}

function fire(n) {
  show({ title: String(n.title || "Planner"), body: String(n.body || "") }, () => {
    showWindow();
    if (win) win.webContents.send("notif:action", { actionId: "tap", notification: n });
  });
}

function tick() {
  const now = Date.now();
  const from = Math.max(lastTick, now - MAX_LATE_MS);
  lastTick = now;
  if (Notification.isSupported()) dueBetween(scheduled, from, now).forEach(fire);
  scheduled = stillPending(scheduled, now);
}

ipcMain.handle("notif:schedule", (_e, opts) => {
  const list = (opts && Array.isArray(opts.notifications)) ? opts.notifications : [];
  const ids = new Set(list.map((n) => Number(n.id)));
  scheduled = scheduled.filter((n) => !ids.has(Number(n.id))).concat(list);
  return { notifications: list.map((n) => ({ id: n.id })) };
});

ipcMain.handle("notif:pending", () => ({ notifications: scheduled }));

ipcMain.handle("notif:cancel", (_e, opts) => {
  const ids = new Set(((opts && opts.notifications) || []).map((n) => Number(n.id)));
  scheduled = scheduled.filter((n) => !ids.has(Number(n.id)));
});

// ---------- Automatic backups ----------
// The page sends the backup text; only files named planner-auto-YYYY-MM-DD.json are written, in one folder.
const AUTO_NAME = /^planner-auto-\d{4}-\d{2}-\d{2}\.json$/;
ipcMain.handle("backup:auto", (_e, opts) => {
  const { name, json, keep } = opts || {};
  if (typeof name !== "string" || !AUTO_NAME.test(name)) throw new Error("bad backup name");
  if (typeof json !== "string" || json.length > 20 * 1024 * 1024) throw new Error("bad backup data");
  const dir = path.join(app.getPath("documents"), "Planner", "Auto backups");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), json, "utf8");
  const keepN = Math.min(Math.max(Number(keep) || 7, 1), 60);
  const old = fs.readdirSync(dir).filter((f) => AUTO_NAME.test(f)).sort().slice(0, -keepN);
  old.forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* keep going */ } });
  return { path: path.join(dir, name) };
});

// ---------- Wi-Fi sync with the phone ----------
// While the "Sync with phone" window is open, a small server on the home network accepts one kind of
// request: POST /planner-sync with an encrypted message. It is handed to the page, which checks the
// one-time code, merges and answers. The server stops after 10 minutes, on close, or on quit.
const SYNC_PORT = 47832;
const SYNC_MAX_BODY = 25 * 1024 * 1024;
let syncServer = null;
let syncOwner = null; // the page that started the sync
let syncStopTimer = null;
let syncSeq = 0;
const syncWaiting = new Map();

/** This PC's addresses on the local network (Wi-Fi / Ethernet), private ranges first. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return out.sort((a, b) => isPrivate(b) - isPrivate(a));
}

function stopSync() {
  clearTimeout(syncStopTimer);
  for (const done of syncWaiting.values()) done({ status: 410, body: "{}" });
  syncWaiting.clear();
  if (syncServer) { syncServer.close(); syncServer = null; }
  syncOwner = null;
}

function handleSyncRequest(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(body);
  };
  if (req.method !== "POST" || req.url !== "/planner-sync") return send(404, "{}");
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > SYNC_MAX_BODY) { send(413, "{}"); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded || !syncOwner || syncOwner.isDestroyed()) return res.writableEnded || send(410, "{}");
    const id = ++syncSeq;
    const timer = setTimeout(() => { syncWaiting.delete(id); send(504, "{}"); }, 60 * 1000);
    syncWaiting.set(id, ({ status, body }) => { clearTimeout(timer); send(status, body); });
    syncOwner.send("sync:request", { id, body: Buffer.concat(chunks).toString("utf8") });
  });
}

ipcMain.handle("sync:start", async (e) => {
  stopSync();
  syncOwner = e.sender;
  syncServer = http.createServer(handleSyncRequest);
  const listen = (port) => new Promise((resolve, reject) => {
    syncServer.once("error", reject);
    syncServer.listen(port, "0.0.0.0", () => resolve(syncServer.address().port));
  });
  let port;
  try { port = await listen(SYNC_PORT); } catch { port = await listen(0); } // port taken: use any free one
  syncStopTimer = setTimeout(stopSync, 10 * 60 * 1000);
  return { addresses: lanAddresses(), port };
});

ipcMain.handle("sync:stop", () => { stopSync(); });

ipcMain.handle("sync:reply", (_e, msg) => {
  const done = msg && syncWaiting.get(msg.id);
  if (!done) return;
  syncWaiting.delete(msg.id);
  const status = [200, 403, 410, 500].includes(msg.status) ? msg.status : 500;
  done({ status, body: typeof msg.body === "string" ? msg.body : "{}" });
});

app.on("will-quit", stopSync);

// ---------- Start ----------
function start() {
  const startHidden = process.argv.includes("--hidden");
  createWindow(!startHidden);
  createTray();
  setInterval(tick, TICK_MS);
}

app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* stay in the tray */ });
