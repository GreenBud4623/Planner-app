// Tests tab, test reminders, grades and averages, evening heads-up.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { useApp, stored, scheduled, settle, day } = require("./helpers");

const CLASSES = [
  { id: "ma", name: "Maths", day: 0, start: "08:00", end: "08:50", color: "#16a34a" },
  { id: "bi", name: "Biology", day: 1, start: "09:00", end: "09:50", color: "#0891b2" },
];

describe("Tests, grades and the evening heads-up", () => {
  const app = useApp();

  it("adds a test with a reminder the evening before", async () => {
    const page = await app.open({ data: { tasks: [], classes: CLASSES } });
    await page.tap('.tab[data-tab="tests"]');
    await page.tap("#addBtn");
    assert.equal(await page.evaluate(() => document.querySelector("input[name=type]:checked").value), "test");
    await page.selectOption("#fClass", "Maths");
    assert.equal(await page.inputValue("#fDate"), day(3), "next Maths lesson is Monday");
    assert.equal(await page.inputValue("#fRemind"), "1440");
    await page.click("#taskForm button[type=submit]");
    assert.equal((await stored(page)).tasks[0].title, "Maths test");
    await settle(page);
    const r = (await scheduled(page)).find((n) => n.extra.kind === "reminder");
    assert.equal(new Date(r.at).toISOString(), new Date(`${day(2)}T18:00:00+02:00`).toISOString());
    assert.deepEqual(await page.locator("#testSections .section-title").first().textContent(), "Next 7 days · 1");
  });

  it("averages grades per class, counting test grades too", async () => {
    const page = await app.open({ data: { classes: CLASSES,
      tasks: [{ id: "t", type: "test", title: "Fractions", className: "Maths", date: day(-7), grade: "8", createdAt: 1 }] } });
    await page.tap('.tab[data-tab="tests"]');
    await page.locator(".grades-section .mini-btn").tap();
    await page.fill("#gValue", "9,5");
    await page.selectOption("#gClass", "Maths");
    await page.click("#gradeForm button[type=submit]");
    assert.match(await page.textContent("#toast"), /Maths average: 8\.75/);
    await page.locator(".grades-section .mini-btn").tap();
    await page.fill("#gValue", "10");
    await page.selectOption("#gClass", "Biology");
    await page.click("#gradeForm button[type=submit]");
    assert.equal(await page.textContent(".overall-card .avg-big"), "9.38");
    await page.locator(".avg-row", { hasText: "Maths" }).tap();
    assert.equal(await page.locator(".grade-item").count(), 2);
  });

  it("rejects a grade that isn't a number", async () => {
    const page = await app.open({ data: { tasks: [], classes: CLASSES } });
    await page.tap('.tab[data-tab="tests"]');
    await page.locator(".grades-section .mini-btn").tap();
    await page.fill("#gValue", "abc");
    await page.click("#gradeForm button[type=submit]");
    assert.match(await page.textContent("#toast"), /as a number/);
    assert.equal(((await stored(page)).grades || []).length, 0);
  });

  it("sends an evening heads-up for what's due tomorrow", async () => {
    const page = await app.open({ data: { classes: CLASSES, tasks: [
      { id: "h1", type: "homework", title: "Exercises p. 12", className: "Maths", date: day(1), createdAt: 1 },
      { id: "h2", type: "homework", title: "Done already", className: "Maths", date: day(1), done: true, createdAt: 1 },
      { id: "t1", type: "test", title: "Cells", className: "Biology", date: day(1), createdAt: 1 },
    ] } });
    await settle(page);
    const ev = (await scheduled(page)).filter((n) => n.extra.kind === "evening");
    assert.equal(ev.length, 1);
    assert.equal(ev[0].title, "Tomorrow: 1 homework · 1 test");
    assert.match(ev[0].body, /Maths: Exercises p\. 12/);
    assert.doesNotMatch(ev[0].body, /Done already/);
    assert.equal(new Date(ev[0].at).toISOString(), new Date(`${day(0)}T19:00:00+02:00`).toISOString());
  });

  it("the heads-up can be moved or switched off", async () => {
    const page = await app.open({ data: { classes: CLASSES, tasks: [
      { id: "h1", type: "homework", title: "Exercises", className: "Maths", date: day(1), createdAt: 1 }] } });
    await page.tap("#menuBtn");
    await page.fill("#eveningTime", "20:15");
    await page.locator("#eveningTime").dispatchEvent("change");
    await settle(page);
    let ev = (await scheduled(page)).filter((n) => n.extra.kind === "evening");
    assert.equal(new Date(ev[0].at).toISOString(), new Date(`${day(0)}T20:15:00+02:00`).toISOString());
    await page.locator(".evening-label").click();
    await settle(page);
    ev = (await scheduled(page)).filter((n) => n.extra.kind === "evening");
    assert.equal(ev.length, 0);
    assert.deepEqual(page.errors, []);
  });
});
