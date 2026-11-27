// Repeating tasks and checklists.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { useApp, stored, day } = require("./helpers");

const task = (extra) => ({ id: "r", type: "task", title: "Pack gym bag", date: day(0), createdAt: 1, ...extra });

describe("Repeating tasks", () => {
  const app = useApp();

  it("ticking a weekly task creates next week's, only once", async () => {
    const page = await app.open({ data: { classes: [], tasks: [task({ repeat: "weekly", steps: [{ id: "s", text: "Shoes", done: true }] })] } });
    assert.match(await page.textContent(".task-meta"), /🔁 Weekly/);
    await page.locator(".task .check").tap();
    assert.match(await page.textContent("#toast"), /Next one/);
    let tasks = (await stored(page)).tasks;
    assert.equal(tasks.length, 2);
    const next = tasks.find((t) => t.id !== "r");
    assert.equal(next.date, day(7));
    assert.equal(next.done, false);
    assert.equal(next.steps[0].done, false, "checklist starts fresh");
    // untick and tick again: no second copy
    await page.locator(".task .check").first().tap();
    await page.locator(".task .check").first().tap();
    tasks = (await stored(page)).tasks;
    assert.equal(tasks.length, 2);
  });

  it("never creates the next one in the past", async () => {
    const page = await app.open({ data: { classes: [], tasks: [task({ repeat: "daily", date: day(-3) })] } });
    await page.locator("#weekStrip .day").nth(1).tap(); // Tuesday, where the overdue task is
    await page.locator(".task .check").tap();
    const next = (await stored(page)).tasks.find((t) => t.id !== "r");
    assert.equal(next.date, day(0), "the next daily one is today, not in the past");
  });

  it("weekdays skip the weekend; monthly keeps the end of the month", async () => {
    const page = await app.open({ data: { classes: [], tasks: [task({ repeat: "weekdays" })] } });
    await page.locator(".task .check").tap();
    assert.equal((await stored(page)).tasks.find((t) => t.id !== "r").date, day(3), "Friday -> Monday");
    const p2 = await app.open({ data: { classes: [], tasks: [task({ repeat: "monthly", date: "2027-01-31" })] } });
    for (let i = 0; i < 9; i++) await p2.tap("#nextWeek");
    await p2.locator("#weekStrip .day").nth(6).tap(); // Sunday 31 Jan 2027
    await p2.locator(".task .check").tap();
    assert.equal((await stored(p2)).tasks.find((t) => t.id !== "r").date, "2027-02-28");
  });
});

describe("Checklists", () => {
  const app = useApp();

  it("adds steps, saves them and shows the progress", async () => {
    const page = await app.open({ data: { classes: [], tasks: [] } });
    await page.tap('.tab[data-tab="homework"]');
    await page.tap("#addBtn");
    await page.locator(".type-seg label", { hasText: "Long-term" }).click();
    await page.fill("#fTitle", "History project");
    for (const s of ["Research", "Draft", "Final version"]) {
      await page.click("#addStepBtn");
      await page.locator(".step-row .step-text").last().fill(s);
    }
    await page.locator(".step-row .step-check").first().click();
    await page.click("#taskForm button[type=submit]");
    const t = (await stored(page)).tasks[0];
    assert.deepEqual(t.steps.map((s) => [s.text, s.done]), [["Research", true], ["Draft", false], ["Final version", false]]);
    assert.match(await page.textContent(".task-meta"), /☑ 1\/3/);
    assert.equal(await page.locator(".steps-bar").count(), 1);
  });

  it("empty steps are dropped and tests have no checklist", async () => {
    const page = await app.open({ data: { classes: [], tasks: [] } });
    await page.tap("#addBtn");
    await page.fill("#fTitle", "Clean desk");
    await page.click("#addStepBtn");
    await page.click("#taskForm button[type=submit]");
    assert.deepEqual((await stored(page)).tasks[0].steps, []);
    await page.tap("#addBtn");
    await page.locator(".type-seg label", { hasText: "Test" }).click();
    assert.equal(await page.isHidden("#stepsField"), true);
    assert.deepEqual(page.errors, []);
  });
});
