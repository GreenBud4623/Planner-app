// Planner tab: tasks, reminders, overdue, undo.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { useApp, stored, scheduled, settle, day, NOW } = require("./helpers");

describe("Planner tasks", () => {
  const app = useApp();

  it("adds a task with a reminder and keeps it after a restart", async () => {
    const page = await app.open();
    await page.tap("#addBtn");
    await page.fill("#fTitle", "Buy a notebook");
    await page.fill("#fTime", "16:30");
    await page.selectOption("#fRemind", "30");
    await page.click("#taskForm button[type=submit]");
    await page.reload();
    assert.deepEqual(await page.locator(".task-title").allTextContents(), ["Buy a notebook"]);
    await settle(page);
    const n = (await scheduled(page)).find((x) => x.extra.kind === "reminder");
    assert.ok(n, "a reminder was scheduled");
    assert.equal(new Date(n.at).toISOString(), new Date("2026-11-27T16:00:00+02:00").toISOString(), "30 minutes before 16:30");
    assert.deepEqual(page.errors, []);
  });

  it("ticks, deletes and undoes", async () => {
    const page = await app.open({ data: { tasks: [{ id: "a", type: "task", title: "Pack gym bag", date: day(0), createdAt: 1 }] } });
    await page.locator(".task .check").tap();
    assert.equal((await stored(page)).tasks[0].done, true);
    await page.locator(".task-body").tap();
    await page.click("#deleteBtn");
    assert.equal((await stored(page)).tasks.length, 0);
    assert.ok("a" in (await stored(page)).deleted, "deletion is remembered for merging backups");
    await page.tap("#toast button");
    assert.equal((await stored(page)).tasks.length, 1);
    assert.ok(!("a" in (await stored(page)).deleted));
  });

  it("moves unfinished tasks from earlier days to today", async () => {
    const page = await app.open({ data: { tasks: [{ id: "a", type: "task", title: "Old", date: day(-3), createdAt: 1 }] } });
    assert.match(await page.textContent("#overdueText"), /1 unfinished task/);
    await page.tap("#moveOverdue");
    assert.equal((await stored(page)).tasks[0].date, day(0));
    assert.equal(await page.isHidden("#overdue"), true);
  });

  it("is a Friday in the tests", () => assert.equal(NOW.getDay(), 5));
});
