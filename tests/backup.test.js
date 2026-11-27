// Automatic backups and restoring (merge / replace / undo).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { useApp, stored, day } = require("./helpers");

const autoFiles = (page) => page.evaluate(() =>
  Object.keys(window.__fs).filter((k) => k.includes("Auto backups/")).map((k) => k.split("/").pop()).sort());
const DATA = { tasks: [{ id: "a", type: "task", title: "Something", date: day(0), createdAt: 1 }], classes: [] };

function writeBackup(obj) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "planner-")), "backup.json");
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

describe("Backups", () => {
  const app = useApp();

  it("saves a daily automatic backup and keeps the last 7", async () => {
    const page = await app.open({ data: DATA });
    await page.evaluate(() => {
      const f = {};
      for (let i = 1; i <= 9; i++) f[`DOCUMENTS/Planner/Auto backups/planner-auto-2026-10-0${i}.json`] = "{}";
      f["DOCUMENTS/Planner/Auto backups/notes.txt"] = "not ours";
      localStorage.setItem("__fs", JSON.stringify(f));
    });
    await page.reload();
    await page.waitForTimeout(3600);
    const files = await autoFiles(page);
    assert.equal(files.filter((n) => n.startsWith("planner-auto")).length, 7);
    assert.ok(files.includes(`planner-auto-${day(0)}.json`));
    assert.ok(files.includes("notes.txt"), "other files are left alone");
  });

  it("doesn't ask for storage permission on its own (Android 10 and older)", async () => {
    const page = await app.open({ data: DATA });
    await page.evaluate(() => { localStorage.setItem("__perm", "prompt"); localStorage.setItem("__fs", "{}"); });
    await page.reload();
    await page.waitForTimeout(3600);
    assert.equal((await autoFiles(page)).length, 0);
    assert.equal(await page.evaluate(() => window.__calls.includes("Filesystem.requestPermissions")), false);
  });

  it("merges: newest version wins and deleted things stay deleted; undo works", async () => {
    const t = Date.now();
    const page = await app.open({ data: { classes: [], deleted: { C: t - 1000 }, tasks: [
      { id: "A", type: "task", title: "A phone", date: day(0), createdAt: 1, updatedAt: t },
      { id: "B", type: "task", title: "B phone", date: day(0), createdAt: 1, updatedAt: t - 5000 }] } });
    const file = writeBackup({ app: "planner", tasks: [
      { id: "A", type: "task", title: "A backup", date: day(0), updatedAt: t - 9000 },
      { id: "B", type: "task", title: "B backup", date: day(0), updatedAt: t - 100 },
      { id: "C", type: "task", title: "C backup", date: day(0), updatedAt: t - 8000 },
      { id: "D", type: "task", title: "D backup", date: day(0), updatedAt: t - 8000 }], classes: [] });
    await page.tap("#menuBtn");
    await page.setInputFiles("#importFile", file);
    await page.click("#restoreMerge");
    assert.deepEqual((await stored(page)).tasks.map((x) => x.title).sort(), ["A phone", "B backup", "D backup"]);
    await page.tap("#toast button");
    assert.deepEqual((await stored(page)).tasks.map((x) => x.title).sort(), ["A phone", "B phone"]);
  });

  it("replaces everything when asked", async () => {
    const page = await app.open({ data: DATA });
    const file = writeBackup({ app: "planner", tasks: [{ id: "Z", type: "task", title: "From backup", date: day(0) }], classes: [] });
    await page.tap("#menuBtn");
    await page.setInputFiles("#importFile", file);
    await page.click("#restoreReplace");
    assert.deepEqual((await stored(page)).tasks.map((x) => x.title), ["From backup"]);
  });

  it("refuses files that aren't backups", async () => {
    const page = await app.open({ data: DATA });
    await page.tap("#menuBtn");
    await page.setInputFiles("#importFile", writeBackup({ hello: 1 }));
    assert.match(await page.textContent("#toast"), /isn't a Planner backup/);
    assert.deepEqual(page.errors, []);
  });
});
