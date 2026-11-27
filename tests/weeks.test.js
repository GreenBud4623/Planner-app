// Week A / Week B classes.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { useApp, stored, scheduled, settle, day } = require("./helpers");

// "Now" is Friday 27 Nov 2026, 13:00; the week of 23 Nov is Week A.
const MONDAY = day(-4);
const ART_B = { id: "art", name: "Art", day: 4, start: "11:00", end: "11:50", color: "#db2777", homeworkCheck: true, checkSince: 1, weeks: "B" };
const MUSIC_A = { id: "mu", name: "Music", day: 4, start: "11:00", end: "11:50", color: "#7c3aed", weeks: "A" };

describe("Week A / Week B", () => {
  const app = useApp();

  it("only shows a class in its own weeks", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ART_B, MUSIC_A], weekA: MONDAY } });
    assert.match(await page.textContent("#dayLabel"), /Week A/);
    assert.deepEqual(await page.locator("#dayClasses .class-name").allTextContents(), ["Music"]);
    assert.equal(await page.evaluate(() => document.getElementById("hwSheet").open), false, "no Art lesson this week");
    await page.tap("#nextWeek");
    assert.match(await page.textContent("#dayLabel"), /Week B/);
    assert.deepEqual(await page.locator("#dayClasses .class-name").allTextContents(), ["Art"]);
  });

  it("plans check-ins only for Week B Fridays", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ART_B], weekA: MONDAY } });
    await settle(page);
    const dates = (await scheduled(page)).filter((n) => n.extra.kind === "hwcheck").map((n) => n.extra.date);
    assert.deepEqual(dates, [day(7), day(21), day(35)]);
  });

  it("A and B classes at the same time are not a clash", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ART_B, MUSIC_A], weekA: MONDAY } });
    await page.tap('.tab[data-tab="timetable"]');
    assert.equal(await page.locator(".overlap-group").count(), 0);
    assert.match(await page.textContent("#weekABar"), /This week is Week A/);
  });

  it("swapping A/B makes today's Art lesson happen (and asks about it)", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ART_B], weekA: MONDAY } });
    await page.tap('.tab[data-tab="timetable"]');
    await page.tap("#swapWeeks");
    assert.match(await page.textContent("#weekABar"), /This week is Week B/);
    await page.reload();
    await page.waitForTimeout(600);
    assert.deepEqual(await page.locator(".hw-row .hw-class").allTextContents(), ["Art"]);
  });

  it("the first Week A/B class makes this week Week A", async () => {
    const page = await app.open({ data: { tasks: [], classes: [] } });
    await page.tap('.tab[data-tab="timetable"]');
    await page.tap("#addBtn");
    await page.fill("#cName", "Drama");
    await page.locator(".weeks-seg label", { hasText: "Week B" }).click();
    await page.fill("#cStart", "15:00");
    await page.fill("#cEnd", "15:50");
    await page.click("#classForm button[type=submit]");
    const s = await stored(page);
    assert.equal(s.weekA, MONDAY);
    assert.equal(s.classes[0].weeks, "B");
    assert.match(await page.textContent(".class-card"), /Week B only/);
    assert.deepEqual(page.errors, []);
  });
});
