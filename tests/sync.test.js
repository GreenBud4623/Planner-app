// Phone <-> PC sync over Wi-Fi: a phone page and a "Windows app" page talking to each other,
// plus the Windows app's local server (with a stand-in for Electron).
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const Module = require("node:module");
const { useApp, stored, day } = require("./helpers");

// The Windows app's bridge (desktop/preload.js), with the server replaced by a direct hand-off.
const FAKE_WINDOWS = `
window.__replies = {};
window.plannerDesktop = {
  platform: "windows",
  notifications: {
    checkPermissions: async () => ({ display: "granted" }), requestPermissions: async () => ({ display: "granted" }),
    createChannel: async () => {}, registerActionTypes: async () => {}, schedule: async () => ({}),
    getPending: async () => ({ notifications: [] }), cancel: async () => {}, addListener: async () => ({ remove() {} }),
  },
  sync: {
    start: async () => ({ addresses: ["192.168.1.20"], port: 47832 }),
    stop: async () => { window.__stopped = true; },
    onRequest: (cb) => { window.__syncCb = cb; },
    reply: async (id, status, body) => { window.__replies[id]({ status, body }); },
  },
};
window.__handle = (body) => new Promise((resolve) => {
  const id = Math.random();
  window.__replies[id] = resolve;
  window.__syncCb({ id, body });
});`;
// On the phone, the native HTTP call goes to the PC page through the test.
const PHONE_HTTP = `window.__plugins = { CapacitorHttp: { request: async (o) => {
  const r = await window.__toPC(JSON.stringify(o.data));
  return { status: r.status, data: JSON.parse(r.body || "{}") };
} } };`;

const PHONE_DATA = { classes: [], tasks: [
  { id: "p1", type: "homework", title: "From phone", className: "Maths", date: day(1), createdAt: 1, updatedAt: 1000 },
  { id: "both", type: "task", title: "Edited on phone (newer)", date: day(0), createdAt: 1, updatedAt: 5000 }] };
const PC_DATA = { classes: [{ id: "c", name: "Maths", day: 0, start: "08:00", end: "08:50", color: "#16a34a" }], tasks: [
  { id: "pc1", type: "task", title: "From PC", date: day(0), createdAt: 1, updatedAt: 1000 },
  { id: "both", type: "task", title: "Old on PC", date: day(0), createdAt: 1, updatedAt: 2000 }] };

async function pair(app) {
  const pc = await app.open({ native: false, extraScript: FAKE_WINDOWS, data: PC_DATA });
  const phone = await app.open({ extraScript: PHONE_HTTP, data: PHONE_DATA });
  await phone.exposeFunction("__toPC", (body) => pc.evaluate((b) => window.__handle(b), body));
  await pc.tap("#menuBtn");
  assert.equal(await pc.textContent("#syncBtn"), "Sync with phone (Wi-Fi)");
  await pc.click("#syncBtn");
  await pc.waitForTimeout(200);
  return { pc, phone, code: await pc.textContent("#scCode") };
}

async function phoneSync(phone, code) {
  await phone.tap("#menuBtn");
  assert.equal(await phone.textContent("#syncBtn"), "Sync with PC (Wi-Fi)");
  await phone.click("#syncBtn");
  await phone.fill("#spAddress", "192.168.1.20");
  await phone.fill("#spCode", code);
  await phone.click("#spGo");
  await phone.waitForFunction(() => !document.getElementById("spGo").disabled, null, { timeout: 15000 });
}

describe("Phone <-> PC sync", () => {
  const app = useApp();

  it("both end up with everything, newest edit wins", async () => {
    const { pc, phone, code } = await pair(app);
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.match(await pc.textContent("#scAddress"), /192\.168\.1\.20:47832/);
    await phoneSync(phone, code.toLowerCase().replace("-", " ")); // typing it loosely still works
    const titles = async (p) => (await stored(p)).tasks.map((t) => t.title).sort();
    const want = ["Edited on phone (newer)", "From PC", "From phone"];
    assert.deepEqual(await titles(phone), want);
    assert.deepEqual(await titles(pc), want);
    assert.equal((await stored(phone)).classes.length, 1, "the PC's timetable reached the phone");
    assert.match(await phone.textContent("#toast"), /Synced with your PC/);
    assert.match(await pc.textContent("#scStatus"), /Synced/);
    assert.equal(await phone.evaluate(() => JSON.parse(localStorage.getItem("planner.settings")).syncAddress), "192.168.1.20:47832");
    assert.deepEqual(phone.errors, []);
    assert.deepEqual(pc.errors, []);
  });

  it("a wrong code changes nothing, and 5 wrong codes stop the sync", async () => {
    const { pc, phone } = await pair(app);
    await phoneSync(phone, "AAAA-AAAA");
    assert.match(await phone.textContent("#spStatus"), /Wrong code/);
    assert.equal((await stored(pc)).tasks.length, 2);
    assert.equal((await stored(phone)).tasks.length, 2);
    for (let i = 0; i < 4; i++) await phone.click("#spGo"), await phone.waitForFunction(() => !document.getElementById("spGo").disabled);
    assert.equal(await pc.evaluate(() => window.__stopped === true), true);
    assert.equal(await pc.evaluate(() => document.getElementById("syncPcSheet").open), false);
  });

  it("checks the address and code before trying", async () => {
    const phone = await app.open({ extraScript: PHONE_HTTP, data: PHONE_DATA });
    await phone.tap("#menuBtn");
    await phone.click("#syncBtn");
    await phone.fill("#spAddress", "not an address!");
    await phone.click("#spGo");
    assert.match(await phone.textContent("#spStatus"), /Type the address/);
    await phone.fill("#spAddress", "192.168.1.20:47832");
    await phone.fill("#spCode", "ABC");
    await phone.click("#spGo");
    assert.match(await phone.textContent("#spStatus"), /8 letters and numbers/);
  });

  it("the plain web version has no sync button", async () => {
    const web = await app.open({ native: false });
    assert.equal(await web.isHidden("#syncBtn"), true);
  });
});

describe("Windows sync server", () => {
  let handlers, sent, stop;
  before(() => {
    handlers = {};
    sent = [];
    const fake = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {}, whenReady: () => new Promise(() => {}),
        setAppUserModelId() {}, getPath: () => os.tmpdir() },
      ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
      BrowserWindow: function () {}, Tray: function () {}, Menu: {}, Notification: { isSupported: () => false },
      nativeImage: {}, nativeTheme: {}, shell: {},
    };
    const load = Module._load;
    Module._load = function (req, ...rest) { return req === "electron" ? fake : load.call(this, req, ...rest); };
    try { delete require.cache[require.resolve("../desktop/main.js")]; require("../desktop/main.js"); } finally { Module._load = load; }
    stop = () => handlers["sync:stop"]();
  });
  after(() => stop && stop());

  const post = (port, path, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });

  it("passes the message to the page and sends back its answer", async () => {
    const sender = { isDestroyed: () => false, send: (ch, msg) => {
      sent.push(msg);
      setImmediate(() => handlers["sync:reply"](null, { id: msg.id, status: 200, body: JSON.stringify({ echo: msg.body }) }));
    } };
    const info = await handlers["sync:start"]({ sender });
    assert.ok(info.port > 0);
    assert.ok(Array.isArray(info.addresses));
    const res = await post(info.port, "/planner-sync", '{"hello":1}');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { echo: '{"hello":1}' });
    assert.equal((await post(info.port, "/other", "{}")).status, 404, "only /planner-sync is served");
    stop();
    await assert.rejects(post(info.port, "/planner-sync", "{}"), "stopped servers refuse connections");
  });
});
