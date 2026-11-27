// Timetable, after-class homework check-ins, missed lessons, holidays.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { useApp, stored, scheduled, settle, day } = require("./helpers");

// Friday = 4 (Monday = 0). "Now" is 13:00, so a 11:00–11:50 class has just ended.
const ENDED = { id: "en", name: "English", day: 4, start: "11:00", end: "11:50", color: "#16a34a", homeworkCheck: true, checkSince: 1 };
const LATER = { id: "ma", name: "Maths", day: 4, start: "14:00", end: "14:50", color: "#0891b2", homeworkCheck: true, checkSince: 1 };
const popupOpen = (page) => page.evaluate(() => document.getElementById("hwSheet").open);

describe("Classes and homework check-ins", () => {
  const app = useApp();

  it("adds a class on several days and shows overlapping classes together", async () => {
    const page = await app.open();
    await page.tap('.tab[data-tab="timetable"]');
    await page.tap("#addBtn");
    await page.fill("#cName", "Physics");
    await page.locator("#cDays label").nth(4).click(); // untick today (Friday)
    await page.locator("#cDays label").nth(0).click();
    await page.locator("#cDays label").nth(2).click();
    await page.fill("#cStart", "08:00");
    await page.fill("#cEnd", "08:50");
    await page.click("#classForm button[type=submit]");
    assert.deepEqual((await stored(page)).classes.map((c) => c.day).sort(), [0, 2]);
    await page.tap("#addBtn");
    await page.fill("#cName", "Chemistry");
    await page.locator("#cDays label").nth(4).click();
    await page.locator("#cDays label").nth(0).click();
    await page.fill("#cStart", "08:30");
    await page.fill("#cEnd", "09:20");
    await page.click("#classForm button[type=submit]");
    assert.match(await page.textContent("#toast"), /same time as Physics/);
    assert.equal(await page.locator(".overlap-group").count(), 1);
  });

  it("asks about a lesson that just ended, and answering adds homework", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ENDED, LATER] } });
    assert.equal(await popupOpen(page), true);
    assert.deepEqual(await page.locator(".hw-row .hw-class").allTextContents(), ["English"]);
    await page.fill(".hw-row .hw-text", "Read chapter 4");
    await page.click("#hwForm button[type=submit]");
    const s = await stored(page);
    assert.equal(s.tasks[0].type, "homework");
    assert.equal(s.tasks[0].className, "English");
    assert.ok(s.hwAnswered[`en@${day(0)}`]);
    await page.reload();
    assert.equal(await popupOpen(page), false);
  });

  it("'I was absent' sends the lesson to To recover", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ENDED] } });
    await page.tap(".hw-row .hw-absent");
    await page.click("#hwForm button[type=submit]");
    const t = (await stored(page)).tasks[0];
    assert.equal(t.type, "recover");
    assert.equal(t.missedDate, day(0));
  });

  it("marking a class as missed from the Planner stops the question", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ENDED] } });
    await page.click("#hwLaterBtn");
    await page.locator("#dayClasses .class-row-main").click();
    await page.click("#caMissed");
    await page.click("#taskForm button[type=submit]");
    await page.reload();
    assert.equal(await popupOpen(page), false);
  });

  it("answers from the notification: type it, no homework, absent", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ENDED] } });
    await page.click("#hwLaterBtn");
    const fire = (a) => page.evaluate((a) => window.__fire("LocalNotifications:localNotificationActionPerformed", a), a);
    await fire({ actionId: "reply", inputValue: "Essay draft", notification: { extra: { kind: "hwcheck", classId: "en", date: day(0) } } });
    assert.equal((await stored(page)).tasks[0].title, "Essay draft");
    await fire({ actionId: "none", notification: { extra: { kind: "hwcheck", classId: "en", date: day(-7) } } });
    assert.ok((await stored(page)).hwAnswered[`en@${day(-7)}`]);
    await fire({ actionId: "absent", notification: { extra: { kind: "hwcheck", classId: "en", date: day(-14) } } });
    assert.equal((await stored(page)).tasks.find((t) => t.type === "recover").missedDate, day(-14));
  });

  it("plans one check-in per lesson for 6 weeks, with a keep-going reminder", async () => {
    const page = await app.open({ data: { tasks: [], classes: [LATER] } });
    await page.click("#hwLaterBtn").catch(() => {});
    await settle(page);
    const checks = (await scheduled(page)).filter((n) => n.extra.kind === "hwcheck");
    assert.equal(checks.length, 6, "today's 14:50 lesson plus the next five Fridays");
    assert.ok(checks.every((n) => n.extra.date && !n.schedule.on), "no weekly repeats");
    assert.ok((await scheduled(page)).some((n) => n.extra.kind === "keepalive"));
  });

  it("holidays hide classes and pause check-ins", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ENDED, LATER],
      holidays: [{ id: "h", name: "Winter break", from: day(0), to: day(10) }] } });
    assert.equal(await popupOpen(page), false);
    assert.match(await page.textContent(".holiday-banner"), /Winter break — no classes/);
    assert.equal(await page.locator("#dayClasses .class-row").count(), 0);
    await settle(page);
    const dates = (await scheduled(page)).filter((n) => n.extra.kind === "hwcheck").map((n) => n.extra.date);
    assert.ok(dates.length > 0 && dates.every((d) => d > day(10)), "no check-ins during the break");
    // suggested due date jumps past the break
    await page.tap("#addBtn");
    await page.locator(".type-seg label", { hasText: "Homework" }).click();
    await page.selectOption("#fClass", "Maths");
    assert.equal(await page.inputValue("#fDate"), day(14));
  });

  it("has no errors", async () => {
    const page = await app.open({ data: { tasks: [], classes: [ENDED, LATER] } });
    await page.click("#hwLaterBtn");
    for (const tab of ["timetable", "homework", "tests", "plan"]) await page.tap(`.tab[data-tab="${tab}"]`);
    assert.deepEqual(page.errors, []);
  });
});
