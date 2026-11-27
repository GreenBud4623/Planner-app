// What the app sends to the Android home-screen widget.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { useApp, day } = require("./helpers");

const CAPTURE = `window.__plugins = { WidgetBridge: { update: async (o) => { window.__widget = JSON.parse(o.data); return {}; } } };`;
const widget = (page) => page.evaluate(() => window.__widget);

describe("Home-screen widget", () => {
  const app = useApp();

  it("gets today's classes, what's due and a line about tomorrow", async () => {
    const page = await app.open({ extraScript: CAPTURE, data: {
      classes: [
        { id: "m", name: "Maths", day: 4, start: "08:00", end: "08:50", color: "#16a34a", room: "Room 12" },
        { id: "b", name: "Biology", day: 4, start: "10:00", end: "10:50", color: "#0891b2" },
        { id: "x", name: "Art", day: 0, start: "08:00", end: "08:50", color: "#db2777" }],
      tasks: [
        { id: "1", type: "homework", title: "Exercises p. 12", className: "Maths", date: day(0), createdAt: 1 },
        { id: "2", type: "task", title: "Done thing", date: day(0), done: true, createdAt: 2 },
        { id: "3", type: "test", title: "Cells", className: "Biology", date: day(1), createdAt: 3 }],
    } });
    await page.waitForTimeout(500);
    const w = await widget(page);
    assert.ok(w, "the app sent a summary");
    const today = w.days[day(0)];
    assert.deepEqual(today.classes, ["8:00 AM  Maths · Room 12", "10:00 AM  Biology"]);
    assert.deepEqual(today.due, ["📝 Maths: Exercises p. 12"], "finished tasks are left out");
    assert.equal(today.tomorrow, "Tomorrow: 1 test");
    assert.ok(w.days[day(3)].classes[0].includes("Art"), "Monday is included too");
    assert.equal(Object.keys(w.days).length, 8);
  });

  it("updates after a change and shows holidays", async () => {
    const page = await app.open({ extraScript: CAPTURE, data: { tasks: [], classes: [],
      holidays: [{ id: "h", name: "Winter break", from: day(0), to: day(3) }] } });
    await page.waitForTimeout(500);
    assert.equal((await widget(page)).days[day(0)].holiday, "Winter break");
    await page.tap("#addBtn");
    await page.fill("#fTitle", "Call grandma");
    await page.click("#taskForm button[type=submit]");
    await page.waitForTimeout(500);
    assert.deepEqual((await widget(page)).days[day(0)].due, ["• Call grandma"]);
    assert.deepEqual(page.errors, []);
  });
});
