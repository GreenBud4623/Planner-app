// Windows app (desktop/): notification scheduler and the automatic-backup handler,
// tested in plain Node with a stand-in for Electron.
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { dueBetween, stillPending, lastOccurrence } = require("../desktop/scheduler");

describe("Windows notification scheduler", () => {
  it("fires one-off notifications once and drops them afterwards", () => {
    const now = Date.now();
    const list = [{ id: 1, schedule: { at: new Date(now - 5000) } }, { id: 2, schedule: { at: new Date(now + 864e5) } }];
    assert.deepEqual(dueBetween(list, now - 15000, now).map((n) => n.id), [1]);
    assert.deepEqual(stillPending(list, now).map((n) => n.id), [2]);
  });

  it("finds the last weekly occurrence", () => {
    const fri = new Date(2026, 10, 27, 13, 0).getTime(); // Friday 13:00
    const n = { schedule: { on: { weekday: 6, hour: 12, minute: 0 } } }; // Fridays 12:00 (Sunday = 1)
    assert.equal(lastOccurrence(n, fri), new Date(2026, 10, 27, 12, 0).getTime());
  });
});

describe("Windows automatic backups", () => {
  let handler, docs;
  before(() => {
    docs = fs.mkdtempSync(path.join(os.tmpdir(), "planner-docs-"));
    const handlers = {};
    const fake = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {}, whenReady: () => new Promise(() => {}),
        setAppUserModelId() {}, getPath: (k) => (k === "documents" ? docs : os.tmpdir()) },
      ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
      BrowserWindow: function () {}, Tray: function () {}, Menu: {}, Notification: { isSupported: () => false },
      nativeImage: {}, nativeTheme: {}, shell: {},
    };
    const load = Module._load;
    Module._load = function (req, ...rest) { return req === "electron" ? fake : load.call(this, req, ...rest); };
    try { require("../desktop/main.js"); } finally { Module._load = load; }
    handler = handlers["backup:auto"];
  });

  it("writes the backup and keeps the newest 7", () => {
    const dir = path.join(docs, "Planner", "Auto backups");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 8; i++) fs.writeFileSync(path.join(dir, `planner-auto-2026-10-0${i}.json`), "{}");
    handler(null, { name: "planner-auto-2026-11-27.json", json: '{"tasks":[]}', keep: 7 });
    const files = fs.readdirSync(dir).sort();
    assert.equal(files.length, 7);
    assert.equal(files.at(-1), "planner-auto-2026-11-27.json");
  });

  it("refuses any other file name or data", () => {
    for (const name of ["../evil.json", "notes.txt", "planner-auto-2026-11-27.json/../../x", "..\\x.json"]) {
      assert.throws(() => handler(null, { name, json: "{}" }), `blocked ${name}`);
    }
    assert.throws(() => handler(null, { name: "planner-auto-2026-11-28.json", json: 42 }));
  });
});
