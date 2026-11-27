/* Planner — a private, offline planner for school and life.
 * All data is kept on the phone (WebView/browser localStorage). Nothing is sent anywhere.
 * When running as the Android app (Capacitor), it also uses native notifications
 * (task reminders + after-class homework check-ins), haptics, the back button and file saving.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "planner.v1";
  const PRIORITY_RANK = { high: 0, med: 1, low: 2 };
  const PRIORITY_LABEL = { high: "High", med: "Medium", low: "Low" };
  const TYPES = ["task", "homework", "longterm", "recover", "test"];
  const CLASS_TYPES = ["homework", "recover", "test"]; // item types linked to a class
  const DATELESS_TYPES = ["longterm", "recover"]; // date is optional for these
  const CLASS_COLORS = ["#16a34a", "#0891b2", "#4f46e5", "#d97706", "#dc2626", "#db2777", "#7c3aed", "#64748b"];
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const CHECK_LOOKBACK_DAYS = 7; // only ask about classes from the last week
  const CHECK_HORIZON_DAYS = 42; // after-class notifications are planned this far ahead
  const MAX_CHECK_NOTIFICATIONS = 250; // Android allows an app about 500 alarms in total

  // ---------- Dates (always local time) ----------
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayISO = () => toISO(new Date());
  const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7)); // weeks start Monday
  const weekdayIdx = (d) => (d.getDay() + 6) % 7; // Monday = 0 … Sunday = 6
  const dayDiff = (iso) => Math.round((fromISO(iso) - fromISO(todayISO())) / 864e5);
  const atTime = (iso, hhmm) => { const d = fromISO(iso); const [h, m] = hhmm.split(":").map(Number); d.setHours(h, m, 0, 0); return d; };

  const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const fmtDow = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const fmtDowLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
  const fmtShort = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  function formatTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return fmtTime.format(new Date(2000, 0, 1, h, m));
  }

  function relDay(iso) {
    const diff = dayDiff(iso);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff === -1) return "yesterday";
    if (diff > 1 && diff < 7) return fmtDowLong.format(fromISO(iso));
    return fmtShort.format(fromISO(iso));
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- Native (Android app) bridge ----------
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const plugin = (name) => (isNative ? Cap.registerPlugin(name) : null);
  // ---------- Desktop (Windows app, Electron) bridge ----------
  // desktop/preload.js exposes the same notification API as Capacitor, backed by Windows notifications.
  const Desktop = window.plannerDesktop || null;
  const isDesktop = !!Desktop;
  const Notif = isNative ? plugin("LocalNotifications") : (Desktop ? Desktop.notifications : null);
  const AppPlugin = plugin("App");
  const Haptics = plugin("Haptics");
  const Files = plugin("Filesystem");
  const Share = plugin("Share");

  // ---------- Storage ----------
  let memoryFallback = null; // used if localStorage is blocked (e.g. private mode)

  function emptyState() { return { tasks: [], classes: [], hwAnswered: {}, holidays: [] }; }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return normalizeState(JSON.parse(raw));
    } catch {
      return memoryFallback || emptyState();
    }
  }

  function normalizeState(data) {
    const s = emptyState();
    if (data && Array.isArray(data.tasks)) s.tasks = data.tasks.filter(isValidTask).map(normalizeTask);
    if (data && Array.isArray(data.classes)) s.classes = data.classes.filter(isValidClass).map(normalizeClass);
    if (data && data.hwAnswered && typeof data.hwAnswered === "object") {
      const cutoff = Date.now() - 30 * 864e5; // forget old answers
      for (const [k, v] of Object.entries(data.hwAnswered)) if (typeof v === "number" && v > cutoff) s.hwAnswered[k] = v;
    }
    if (data && Array.isArray(data.holidays)) {
      const old = toISO(addDays(new Date(), -90)); // forget holidays that ended long ago
      s.holidays = data.holidays.filter(isValidHoliday).map(normalizeHoliday).filter((h) => h.to >= old);
    }
    return s;
  }

  function isValidHoliday(h) { return h && typeof h.id === "string" && isISO(h.from) && isISO(h.to) && h.from <= h.to; }
  function normalizeHoliday(h) { return { id: h.id, name: typeof h.name === "string" ? h.name.slice(0, 60) : "", from: h.from, to: h.to }; }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      memoryFallback = state;
      toast("Couldn't save — storage is blocked on this browser");
    }
    scheduleNotificationSync();
  }

  const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isHHMM = (s) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);

  function isValidTask(t) {
    return t && typeof t.id === "string" && typeof t.title === "string" &&
      (isISO(t.date) || (DATELESS_TYPES.includes(t.type) && !t.date));
  }

  function normalizeTask(t) {
    const type = TYPES.includes(t.type) ? t.type : "task";
    return {
      id: t.id,
      type,
      title: String(t.title).slice(0, 200),
      date: isISO(t.date) ? t.date : "",
      time: isHHMM(t.time) ? t.time : "",
      priority: PRIORITY_RANK[t.priority] !== undefined ? t.priority : "med",
      notes: typeof t.notes === "string" ? t.notes.slice(0, 2000) : "",
      done: !!t.done,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
      // minutes before the task time to remind; null = no reminder
      remind: Number.isFinite(t.remind) && t.remind >= 0 ? t.remind : null,
      className: CLASS_TYPES.includes(type) && typeof t.className === "string" ? t.className.slice(0, 80) : "",
      // for "recover": the date of the lesson that was missed
      missedDate: type === "recover" && isISO(t.missedDate) ? t.missedDate : "",
      // for "test": the mark you got, written after the test
      grade: type === "test" && typeof t.grade === "string" ? t.grade.slice(0, 20) : "",
    };
  }

  function isValidClass(c) {
    return c && typeof c.id === "string" && typeof c.name === "string" && Number.isInteger(c.day) &&
      c.day >= 0 && c.day <= 6 && isHHMM(c.start) && isHHMM(c.end);
  }

  function normalizeClass(c) {
    return {
      id: c.id,
      name: c.name.slice(0, 80),
      day: c.day,
      start: c.start,
      end: c.end,
      room: typeof c.room === "string" ? c.room.slice(0, 80) : "",
      color: CLASS_COLORS.includes(c.color) ? c.color : CLASS_COLORS[0],
      homeworkCheck: !!c.homeworkCheck,
      checkSince: typeof c.checkSince === "number" ? c.checkSince : Date.now(),
      createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
    };
  }

  const newId = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---------- State ----------
  let state = load();
  let tab = "plan";
  let selected = todayISO();
  let weekStart = startOfWeek(fromISO(selected));
  let editingId = null;
  let editingClassId = null;
  let hwSnoozed = new Set(); // check-ins the user postponed with "Later" (until the app is reopened)

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    pageTitle: $("pageTitle"), weekBar: $("weekBar"), weekStrip: $("weekStrip"), todayBtn: $("todayBtn"),
    dayLabel: $("dayLabel"), progressText: $("progressText"), progressBar: $("progressBar"),
    overdue: $("overdue"), overdueText: $("overdueText"), dayClasses: $("dayClasses"),
    list: $("taskList"), empty: $("empty"),
    ttIntro: $("ttIntro"), ttList: $("ttList"),
    hwSections: $("hwSections"), hwBadge: $("hwBadge"),
    hwPromptPlan: $("hwPromptPlan"), hwPromptTab: $("hwPromptTab"),
    sheet: $("taskSheet"), form: $("taskForm"), sheetTitle: $("sheetTitle"),
    fTitle: $("fTitle"), fTitleLabel: $("fTitleLabel"), fDate: $("fDate"), fDateLabel: $("fDateLabel"),
    fTime: $("fTime"), fNotes: $("fNotes"), fRemind: $("fRemind"), remindField: $("remindField"),
    fClass: $("fClass"), classField: $("classField"), deleteBtn: $("deleteBtn"),
    fMissed: $("fMissed"), missedField: $("missedField"),
    fGrade: $("fGrade"), gradeField: $("gradeField"), prioField: $("prioField"), fNotesLabel: $("fNotesLabel"),
    testSections: $("testSections"), testBadge: $("testBadge"),
    holidayBox: $("holidayBox"), holidaySheet: $("holidaySheet"), holidayForm: $("holidayForm"), holidayTitle: $("holidayTitle"),
    hName: $("hName"), hFrom: $("hFrom"), hTo: $("hTo"), holidayDeleteBtn: $("holidayDeleteBtn"),
    classActions: $("classActions"), caTitle: $("caTitle"), caWhen: $("caWhen"),
    classSheet: $("classSheet"), classForm: $("classForm"), classSheetTitle: $("classSheetTitle"),
    cName: $("cName"), classNames: $("classNames"), cDays: $("cDays"), cDaysLabel: $("cDaysLabel"),
    cStart: $("cStart"), cEnd: $("cEnd"), cRoom: $("cRoom"), cColors: $("cColors"), cHomework: $("cHomework"),
    classDeleteBtn: $("classDeleteBtn"),
    hwSheet: $("hwSheet"), hwForm: $("hwForm"), hwRows: $("hwRows"),
    menu: $("menuSheet"), importFile: $("importFile"), toast: $("toast"),
  };
  const dialogs = () => [el.sheet, el.classSheet, el.hwSheet, el.classActions, el.holidaySheet, el.menu];
  const anyDialogOpen = () => dialogs().some((d) => d.open);

  // ---------- Classes helpers ----------
  const classesOn = (dayIdx) => state.classes.filter((c) => c.day === dayIdx).sort((a, b) => a.start.localeCompare(b.start));
  const classNamesList = () => [...new Set(state.classes.map((c) => c.name))].sort((a, b) => a.localeCompare(b));
  const classColor = (name) => (state.classes.find((c) => c.name === name) || {}).color || "var(--muted)";

  /** Splits a day's classes (sorted by start) into groups that overlap in time. */
  function overlapGroups(classes) {
    const groups = [];
    let cur = null, curEnd = "";
    for (const c of classes) {
      if (cur && c.start < curEnd) { cur.push(c); if (c.end > curEnd) curEnd = c.end; }
      else { cur = [c]; groups.push(cur); curEnd = c.end; }
    }
    return groups;
  }

  const overlapsWith = (c) => state.classes.filter((o) => o.id !== c.id && o.day === c.day && o.start < c.end && c.start < o.end);

  // ---------- Holidays & days off ----------
  /** The holiday (or day off) that covers this date, if any. */
  const holidayOn = (iso) => state.holidays.find((h) => h.from <= iso && iso <= h.to) || null;
  const holidayLabel = (h) => h.name || (h.from === h.to ? "Day off" : "Holiday");

  /** Date (ISO) of the most recent lesson of a class with this name, on or before `onOrBeforeISO`. */
  function lastLessonDate(name, onOrBeforeISO = todayISO()) {
    const days = new Set(state.classes.filter((c) => c.name === name).map((c) => c.day));
    for (let i = 0; i < 60; i++) {
      const d = addDays(fromISO(onOrBeforeISO), -i);
      if (days.has(weekdayIdx(d)) && !holidayOn(toISO(d))) return toISO(d);
    }
    return onOrBeforeISO;
  }

  /** Answering for a lesson (missed it, or added its homework) means we don't ask about it again. */
  function markLessonAnswered(name, iso) {
    if (!name || !isISO(iso)) return;
    const day = weekdayIdx(fromISO(iso));
    state.classes.forEach((c) => { if (c.name === name && c.day === day) state.hwAnswered[`${c.id}@${iso}`] = Date.now(); });
  }

  const toRecoverCount = (name) => state.tasks.filter((t) => t.type === "recover" && !t.done && t.className === name).length;

  /** Date (ISO) of the next lesson of a class with this name, strictly after `afterISO`. */
  function nextLessonDate(name, afterISO) {
    const days = new Set(state.classes.filter((c) => c.name === name).map((c) => c.day));
    if (!days.size) return toISO(addDays(fromISO(afterISO), 1));
    for (let i = 1; i <= 120; i++) { // skips holidays, so may look past a long break
      const d = addDays(fromISO(afterISO), i);
      if (days.has(weekdayIdx(d)) && !holidayOn(toISO(d))) return toISO(d);
    }
    return toISO(addDays(fromISO(afterISO), 7));
  }

  /** Class lessons with "Weekly homework" ticked that have ended and haven't been answered yet. */
  function pendingChecks() {
    const now = new Date();
    const out = [];
    for (const c of state.classes) {
      if (!c.homeworkCheck) continue;
      for (let back = 0; back < CHECK_LOOKBACK_DAYS; back++) {
        const d = addDays(now, -back);
        if (weekdayIdx(d) !== c.day) continue;
        const iso = toISO(d);
        const end = atTime(iso, c.end);
        if (end > now || end.getTime() < c.checkSince || holidayOn(iso)) continue;
        const key = `${c.id}@${iso}`;
        if (state.hwAnswered[key]) continue;
        out.push({ key, cls: c, date: iso, end });
      }
    }
    return out.sort((a, b) => a.end - b.end);
  }

  /** The most recent lesson of a class that has already ended (for answering from a notification). */
  function lastEndedLesson(cls) {
    const now = new Date();
    for (let back = 0; back < CHECK_LOOKBACK_DAYS; back++) {
      const d = addDays(now, -back);
      if (weekdayIdx(d) === cls.day && atTime(toISO(d), cls.end) <= now) return toISO(d);
    }
    return todayISO();
  }

  // ---------- Rendering: shared ----------
  function sortTasks(a, b) {
    return (a.done - b.done) ||
      ((a.time || "99:99").localeCompare(b.time || "99:99")) ||
      (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) ||
      (a.createdAt - b.createdAt);
  }

  function renderTask(t, opts = {}) {
    const li = document.createElement("li");
    li.className = "task" + (t.done ? " done" : "");
    li.dataset.priority = t.priority;
    li.dataset.type = t.type;
    if (t.type === "test" && t.date && dayDiff(t.date) < 0) li.classList.add("test-past");
    li.innerHTML = `
      <button class="check" type="button">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="task-body" type="button">
        <div class="task-title"></div>
        <div class="task-meta"></div>
      </button>`;
    const check = li.querySelector(".check");
    check.setAttribute("aria-label", t.type === "test"
      ? (t.done ? `Mark "${t.title}" as not studied yet` : `Mark "${t.title}" as studied and ready`)
      : (t.done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`));
    check.setAttribute("aria-pressed", String(t.done));
    check.addEventListener("click", () => toggleDone(t.id));

    li.querySelector(".task-title").textContent = t.title;
    const meta = li.querySelector(".task-meta");
    const add = (text, cls) => { const s = document.createElement("span"); s.textContent = text; if (cls) s.className = cls; meta.appendChild(s); return s; };

    if (t.type === "homework" || t.type === "recover") {
      const tag = add((t.type === "recover" ? "↺ " : "") + (t.className || (t.type === "recover" ? "To recover" : "Homework")), "tag");
      tag.style.setProperty("--tag", classColor(t.className));
      if (t.type === "recover" && t.missedDate) add(`Missed ${relDay(t.missedDate)}`);
    } else if (t.type === "longterm") {
      add("Long-term", "tag tag-long");
    } else if (t.type === "test") {
      const tag = add("🧪 " + (t.className || "Test"), "tag");
      tag.style.setProperty("--tag", classColor(t.className));
      const diff = dayDiff(t.date);
      if (diff >= 0) add(diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `In ${diff} days`, "countdown" + (diff <= 1 ? " soon" : diff <= 3 ? " near" : ""));
      if (opts.showDate && diff > 1) add(fmtShort.format(fromISO(t.date)));
      if (opts.showDate && diff < 0) add(cap(relDay(t.date)));
      if (t.grade) add(`Grade: ${t.grade}`, "grade");
      else if (diff < 0 && opts.showDate) add("Tap to add your grade", "muted-hint");
      if (t.done && diff >= 0) add("Ready ✓", "ready");
    }
    if (opts.showDate && t.date && t.type !== "test") {
      const diff = dayDiff(t.date);
      const word = t.type === "longterm" ? "Deadline" : t.type === "homework" ? "Due" : t.type === "recover" ? "Recover by" : "";
      if (!t.done && diff < 0) add(`${-diff} day${diff < -1 ? "s" : ""} late`, "late");
      else add(word ? `${word} ${relDay(t.date)}` : cap(relDay(t.date)));
    } else if (opts.showDate && t.type === "longterm") {
      add("No deadline");
    }
    if (t.time) add("🕒 " + formatTime(t.time) + (Notif && t.remind !== null && !t.done ? " 🔔" : ""));
    if (!opts.showDate && t.type === "longterm") add("Deadline");
    if (!opts.showDate && t.type === "recover") add("Recover by today");
    if (t.type !== "test" && (t.priority !== "med" || t.type === "task")) add(PRIORITY_LABEL[t.priority] + " priority");
    meta.querySelectorAll("span:empty").forEach((x) => x.remove());

    if (t.notes) {
      const n = document.createElement("div");
      n.className = "task-notes";
      n.textContent = t.notes;
      li.querySelector(".task-body").appendChild(n);
    }
    li.querySelector(".task-body").addEventListener("click", () => openTaskSheet(t.id));
    return li;
  }

  function renderHwPrompts() {
    const pending = pendingChecks();
    for (const box of [el.hwPromptPlan, el.hwPromptTab]) {
      box.hidden = pending.length === 0;
      if (!pending.length) continue;
      box.replaceChildren();
      const txt = document.createElement("span");
      const names = [...new Set(pending.map((p) => p.cls.name))];
      txt.textContent = `Did you get homework in ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}?`;
      const b = document.createElement("button");
      b.type = "button"; b.className = "pill"; b.textContent = "Answer";
      b.addEventListener("click", () => openHomeworkCheck(true));
      box.append(txt, b);
    }
  }

  function render() {
    document.body.dataset.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => {
      if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    ["plan", "timetable", "homework", "tests"].forEach((v) => { $("view-" + v).hidden = v !== tab; });
    el.weekBar.hidden = tab !== "plan";
    el.todayBtn.hidden = tab !== "plan";
    $("addBtn").setAttribute("aria-label", { timetable: "Add class", homework: "Add homework", tests: "Add test" }[tab] || "Add task");
    const soonTests = state.tasks.filter((t) => t.type === "test" && !t.done && t.date && dayDiff(t.date) >= 0 && dayDiff(t.date) <= 2).length;
    el.testBadge.hidden = soonTests === 0;
    el.testBadge.textContent = String(soonTests);

    const pastDue = pastDueItems().length;
    el.hwBadge.hidden = pastDue === 0;
    el.hwBadge.textContent = pastDue > 9 ? "9+" : String(pastDue);

    renderHwPrompts();
    if (tab === "plan") { renderWeek(); renderDay(); }
    else if (tab === "timetable") renderTimetable();
    else if (tab === "tests") renderTests();
    else renderHomework();
  }

  // ---------- Rendering: Planner (day view) ----------
  function tasksOn(iso) { return state.tasks.filter((t) => t.date === iso).sort(sortTasks); }

  function renderWeek() {
    const today = todayISO();
    const datesWithTasks = new Set(state.tasks.filter((t) => !t.done).map((t) => t.date));
    el.pageTitle.textContent = fmtMonth.format(addDays(weekStart, 3));
    el.weekStrip.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const iso = toISO(d);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(iso === selected));
      b.setAttribute("aria-label", fmtDay.format(d));
      if (iso === today) b.classList.add("is-today");
      if (iso === selected) b.classList.add("is-selected");
      if (datesWithTasks.has(iso)) b.classList.add("has-tasks");
      const hol = holidayOn(iso);
      if (hol) { b.classList.add("is-holiday"); b.setAttribute("aria-label", `${fmtDay.format(d)}, ${holidayLabel(hol)}`); }
      b.innerHTML = `<span class="dow"></span><span class="num"></span><span class="dot"></span>`;
      b.querySelector(".dow").textContent = fmtDow.format(d).slice(0, 3);
      b.querySelector(".num").textContent = d.getDate();
      b.addEventListener("click", () => selectDate(iso));
      el.weekStrip.appendChild(b);
    }
  }

  function renderDay() {
    const today = todayISO();
    const d = fromISO(selected);
    const diff = dayDiff(selected);
    const rel = diff === 0 ? "Today · " : diff === 1 ? "Tomorrow · " : diff === -1 ? "Yesterday · " : "";
    el.dayLabel.textContent = rel + fmtDay.format(d);

    const tasks = tasksOn(selected);
    const done = tasks.filter((t) => t.done).length;
    el.progressText.textContent = tasks.length
      ? (done === tasks.length ? `All ${tasks.length} done 🎉` : `${done} of ${tasks.length} done`)
      : "No tasks";
    el.progressBar.style.width = tasks.length ? `${(done / tasks.length) * 100}%` : "0";

    // Overdue banner (plain tasks only — late homework lives in the Homework tab)
    const overdue = selected === today ? state.tasks.filter((t) => t.type === "task" && !t.done && t.date && t.date < today) : [];
    el.overdue.hidden = overdue.length === 0;
    if (overdue.length) {
      el.overdueText.textContent = `${overdue.length} unfinished task${overdue.length > 1 ? "s" : ""} from earlier days`;
    }

    // Classes on this day (none on holidays / days off)
    const holiday = holidayOn(selected);
    const classes = holiday ? [] : classesOn(weekdayIdx(d));
    el.dayClasses.hidden = classes.length === 0 && !holiday;
    el.dayClasses.replaceChildren();
    if (holiday) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "holiday-banner";
      b.innerHTML = `<strong></strong><span class="muted small"></span>`;
      b.querySelector("strong").textContent = `🏖 ${holidayLabel(holiday)} — no classes`;
      b.querySelector("span").textContent = holiday.from === holiday.to ? "Homework check-ins are paused today"
        : `Until ${fmtShort.format(fromISO(holiday.to))} · homework check-ins are paused`;
      b.addEventListener("click", () => openHolidaySheet(holiday.id));
      el.dayClasses.appendChild(b);
    }
    if (classes.length) {
      const h = document.createElement("h3");
      h.className = "section-title";
      h.textContent = "Classes";
      el.dayClasses.appendChild(h);
      const now = new Date();
      for (const group of overlapGroups(classes)) {
       const parent = group.length > 1 ? overlapWrap(el.dayClasses) : el.dayClasses;
       for (const c of group) {
        const row = document.createElement("div");
        row.className = "class-row";
        row.style.setProperty("--c", c.color);
        if (selected === today && atTime(selected, c.start) <= now && now < atTime(selected, c.end)) row.classList.add("now");
        row.innerHTML = `<button type="button" class="class-row-main">
            <span class="class-time"></span><span class="class-name"></span><span class="class-room muted"></span>
          </button>
          <button type="button" class="mini-btn">+ Homework</button>`;
        row.querySelector(".class-time").textContent = `${formatTime(c.start)}–${formatTime(c.end)}`;
        row.querySelector(".class-name").textContent = c.name;
        row.querySelector(".class-room").textContent = c.room;
        row.querySelector(".class-row-main").addEventListener("click", () => openClassActions(c));
        const hb = row.querySelector(".mini-btn");
        hb.setAttribute("aria-label", `Add homework for ${c.name}`);
        hb.addEventListener("click", () => openTaskSheet(null, { type: "homework", className: c.name, date: nextLessonDate(c.name, selected), lessonDate: selected }));
        parent.appendChild(row);
       }
      }
    }

    el.list.replaceChildren(...tasks.map((t) => renderTask(t)));
    el.empty.hidden = tasks.length > 0 || classes.length > 0 || !!holiday;
  }

  /** A box that holds classes taking place at the same time. */
  function overlapWrap(parent) {
    const wrap = document.createElement("div");
    wrap.className = "overlap-group";
    const label = document.createElement("div");
    label.className = "overlap-label";
    label.textContent = "⇄ At the same time";
    wrap.appendChild(label);
    parent.appendChild(wrap);
    return wrap;
  }

  // ---------- Rendering: Timetable ----------
  function renderHolidays() {
    const today = todayISO();
    const list = state.holidays.filter((h) => h.to >= today).sort((a, b) => a.from.localeCompare(b.from));
    el.holidayBox.replaceChildren();
    const head = document.createElement("div");
    head.className = "holiday-head";
    head.innerHTML = `<h3 class="section-title">Holidays &amp; days off</h3><button type="button" class="mini-btn">+ Add</button>`;
    head.querySelector(".mini-btn").setAttribute("aria-label", "Add a holiday or day off");
    head.querySelector(".mini-btn").addEventListener("click", () => openHolidaySheet());
    el.holidayBox.appendChild(head);
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "muted small";
      p.textContent = "Add school holidays or sick days — no homework questions or class notifications on those days.";
      el.holidayBox.appendChild(p);
      return;
    }
    for (const h of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "holiday-row" + (h.from <= today ? " is-now" : "");
      b.innerHTML = `<span class="hr-name"></span><span class="hr-dates muted small"></span>`;
      b.querySelector(".hr-name").textContent = `🏖 ${holidayLabel(h)}${h.from <= today ? " · now" : ""}`;
      b.querySelector(".hr-dates").textContent = h.from === h.to ? fmtShort.format(fromISO(h.from))
        : `${fmtShort.format(fromISO(h.from))} – ${fmtShort.format(fromISO(h.to))}`;
      b.addEventListener("click", () => openHolidaySheet(h.id));
      el.holidayBox.appendChild(b);
    }
  }

  function renderTimetable() {
    el.pageTitle.textContent = "Timetable";
    el.ttIntro.hidden = state.classes.length > 0;
    renderHolidays();
    el.ttList.replaceChildren();
    const todayIdx = weekdayIdx(new Date());
    for (let day = 0; day < 7; day++) {
      const classes = classesOn(day);
      if (day >= 5 && !classes.length) continue; // hide empty weekends
      const sec = document.createElement("section");
      sec.className = "tt-day" + (day === todayIdx ? " is-today" : "");
      const h = document.createElement("h3");
      h.className = "section-title";
      h.textContent = DAY_NAMES[day] + (day === todayIdx ? " · Today" : "");
      sec.appendChild(h);
      if (!classes.length) {
        const p = document.createElement("p");
        p.className = "muted small tt-empty";
        p.textContent = "No classes";
        sec.appendChild(p);
      }
      for (const group of overlapGroups(classes)) {
       const parent = group.length > 1 ? overlapWrap(sec) : sec;
       for (const c of group) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "class-card";
        b.style.setProperty("--c", c.color);
        b.innerHTML = `<span class="cc-time"><span></span><span></span></span>
          <span class="cc-body"><span class="cc-name"></span><span class="cc-meta"></span></span>`;
        const [t1, t2] = b.querySelectorAll(".cc-time span");
        t1.textContent = formatTime(c.start);
        t2.textContent = formatTime(c.end);
        b.querySelector(".cc-name").textContent = c.name;
        const meta = [];
        if (c.room) meta.push(c.room);
        if (c.homeworkCheck) meta.push("📝 Weekly homework");
        const rc = toRecoverCount(c.name);
        if (rc) meta.push(`↺ ${rc} to recover`);
        b.querySelector(".cc-meta").textContent = meta.join(" · ");
        b.addEventListener("click", () => openClassSheet(c.id));
        parent.appendChild(b);
       }
      }
      el.ttList.appendChild(sec);
    }
  }

  // ---------- Rendering: Homework & long-term ----------
  function pastDueItems() {
    const today = todayISO();
    return state.tasks.filter((t) => t.type !== "test" && !t.done && t.date && t.date < today);
  }

  function renderHomework() {
    el.pageTitle.textContent = "Homework";
    const today = todayISO();
    const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || sortTasks(a, b);
    const pastDue = pastDueItems().sort(byDate);
    const homework = state.tasks.filter((t) => t.type === "homework" && !t.done && t.date >= today).sort(byDate);
    const longterm = state.tasks.filter((t) => t.type === "longterm" && !t.done && (!t.date || t.date >= today)).sort(byDate);
    const recover = state.tasks.filter((t) => t.type === "recover" && !t.done && (!t.date || t.date >= today))
      .sort((a, b) => byDate(a, b) || (a.missedDate || "").localeCompare(b.missedDate || ""));
    const doneRecently = state.tasks
      .filter((t) => t.done && ["homework", "longterm", "recover"].includes(t.type) && (!t.date || dayDiff(t.date) >= -14))
      .sort((a, b) => byDate(b, a)).slice(0, 10);

    el.hwSections.replaceChildren();
    const section = (title, items, emptyText, cls) => {
      const sec = document.createElement("section");
      sec.className = "hw-section" + (cls ? " " + cls : "");
      const h = document.createElement("h3");
      h.className = "section-title";
      h.textContent = title + (items.length ? ` · ${items.length}` : "");
      sec.appendChild(h);
      if (items.length) {
        const ul = document.createElement("ul");
        ul.className = "tasks";
        ul.append(...items.map((t) => renderTask(t, { showDate: true })));
        sec.appendChild(ul);
      } else {
        const p = document.createElement("p");
        p.className = "muted small";
        p.textContent = emptyText;
        sec.appendChild(p);
      }
      el.hwSections.appendChild(sec);
    };
    if (pastDue.length) section("Past due", pastDue, "", "past-due");
    section("To recover", recover, "Missed a class? Tap it on the Planner and choose “I missed this class”, or tap + and pick Recover.", "recover");
    section("Homework", homework, "No homework due. 🎉");
    section("Long-term", longterm, "Projects, revision or anything that takes a while. Tap + and pick Long-term.");
    if (doneRecently.length) section("Done recently", doneRecently, "");
  }

  // ---------- Rendering: Tests ----------
  function renderTests() {
    el.pageTitle.textContent = "Tests";
    const tests = state.tasks.filter((t) => t.type === "test" && t.date);
    const byWhen = (a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99");
    const upcoming = tests.filter((t) => dayDiff(t.date) >= 0).sort(byWhen);
    const thisWeek = upcoming.filter((t) => dayDiff(t.date) <= 7);
    const later = upcoming.filter((t) => dayDiff(t.date) > 7);
    const past = tests.filter((t) => dayDiff(t.date) < 0 && dayDiff(t.date) >= -60).sort((a, b) => byWhen(b, a));

    el.testSections.replaceChildren();
    if (!tests.length) {
      const card = document.createElement("div");
      card.className = "hint-card";
      card.innerHTML = "<strong>No tests yet</strong><p>Tap <strong>+</strong> to add a test. Pick the class and date, write what to study, and get a reminder before it. Tick it when you're ready.</p>";
      el.testSections.appendChild(card);
      return;
    }
    const section = (title, items, emptyText, cls) => {
      const sec = document.createElement("section");
      sec.className = "hw-section" + (cls ? " " + cls : "");
      const h = document.createElement("h3");
      h.className = "section-title";
      h.textContent = title + (items.length ? ` · ${items.length}` : "");
      sec.appendChild(h);
      if (items.length) {
        const ul = document.createElement("ul");
        ul.className = "tasks";
        ul.append(...items.map((t) => renderTask(t, { showDate: true })));
        sec.appendChild(ul);
      } else {
        const p = document.createElement("p");
        p.className = "muted small";
        p.textContent = emptyText;
        sec.appendChild(p);
      }
      el.testSections.appendChild(sec);
    };
    section("Next 7 days", thisWeek, "No tests this week. 🎉", "tests-soon");
    if (later.length) section("Later", later, "");
    if (past.length) section("Past tests", past, "", "tests-past");
  }

  // ---------- Navigation ----------
  function setTab(t) {
    if (tab === t) return;
    tab = t;
    window.scrollTo(0, 0);
    render();
  }

  function selectDate(iso) {
    selected = iso;
    const ws = startOfWeek(fromISO(iso));
    if (toISO(ws) !== toISO(weekStart)) weekStart = ws;
    render();
  }

  function shiftWeek(n) {
    weekStart = addDays(weekStart, 7 * n);
    selected = toISO(addDays(fromISO(selected), 7 * n)); // keep the same weekday selected
    render();
  }

  // ---------- Tasks ----------
  function toggleDone(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    save();
    render();
    if (t.done) {
      if (Haptics) Haptics.impact({ style: "LIGHT" }).catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(15);
    }
  }

  function currentType() { return el.form.elements.type.value || "task"; }

  function fillClassSelect(selectedName) {
    const names = classNamesList();
    if (selectedName && !names.includes(selectedName)) names.unshift(selectedName);
    el.fClass.replaceChildren();
    for (const n of names) el.fClass.add(new Option(n, n));
    el.fClass.add(new Option("Other / no class", ""));
    el.fClass.value = selectedName !== undefined && selectedName !== null ? selectedName : (names[0] || "");
  }

  function updateTypeFields() {
    const type = currentType();
    el.classField.hidden = !CLASS_TYPES.includes(type);
    el.missedField.hidden = type !== "recover";
    el.gradeField.hidden = type !== "test" || !editingId;
    el.prioField.hidden = type === "test";
    el.fTitleLabel.innerHTML = type === "homework" ? "Homework" : type === "longterm" ? "Long-term task" :
      type === "recover" ? "What to recover <em>(optional)</em>" : type === "test" ? "Test <em>(topic)</em>" : "Task";
    el.fTitle.placeholder = type === "homework" ? "e.g. Exercises 1–5, page 42" :
      type === "longterm" ? "e.g. History project" :
      type === "recover" ? "e.g. Copy notes, make-up test" :
      type === "test" ? "e.g. Chapter 3 – Fractions" : "What do you need to do?";
    el.fTitle.required = !["recover", "test"].includes(type);
    el.fDateLabel.innerHTML = type === "homework" ? "Due date" : type === "longterm" ? "Deadline <em>(optional)</em>" :
      type === "recover" ? "Recover by <em>(optional)</em>" : type === "test" ? "Test date" : "Date";
    el.fNotesLabel.innerHTML = type === "test" ? "What to study <em>(optional)</em>" : "Notes <em>(optional)</em>";
    el.fDate.required = !DATELESS_TYPES.includes(type);
    setRemindOptions(type);
    updateRemindField();
  }

  const REMIND_OPTIONS = {
    default: [["0", "At the time"], ["10", "10 minutes before"], ["30", "30 minutes before"], ["60", "1 hour before"], ["1440", "1 day before"], ["off", "No reminder"]],
    test: [["1440", "The day before"], ["2880", "2 days before"], ["10080", "1 week before"], ["0", "On the morning of the test"], ["off", "No reminder"]],
  };
  let remindOptionsFor = "";
  function setRemindOptions(type) {
    const key = type === "test" ? "test" : "default";
    if (remindOptionsFor === key) return;
    remindOptionsFor = key;
    const prev = el.fRemind.value;
    el.fRemind.replaceChildren(...REMIND_OPTIONS[key].map(([v, l]) => new Option(l, v)));
    el.fRemind.value = REMIND_OPTIONS[key].some(([v]) => v === prev) ? prev : REMIND_OPTIONS[key][0][0];
  }

  const sheetTitleFor = (type) => ({ homework: "New homework", longterm: "New long-term task", recover: "Class to recover", test: "New test" }[type] || "New task");

  function updateRemindField() {
    el.remindField.hidden = !(Notif && (el.fTime.value || currentType() === "test"));
  }

  let lessonContext = null; // the lesson a new homework item was added from (see markLessonAnswered)
  function openTaskSheet(id = null, preset = {}) {
    editingId = id;
    lessonContext = id ? null : (preset.lessonDate || null);
    const t = id ? state.tasks.find((x) => x.id === id) : null;
    const type = t ? t.type : preset.type || ({ homework: "homework", tests: "test" }[tab] || "task");
    el.form.elements.type.value = type;
    el.sheetTitle.textContent = t ? "Edit" : sheetTitleFor(type);
    el.fTitle.value = t ? (t.type === "recover" && t.title === recoverTitle(t.className) ? "" :
      t.type === "test" && t.title === testTitle(t.className) ? "" : t.title) : "";
    el.fGrade.value = t ? t.grade : "";
    fillClassSelect(t ? t.className : preset.className);
    el.fMissed.value = t ? t.missedDate : (preset.missedDate || (type === "recover" && el.fClass.value ? lastLessonDate(el.fClass.value) : ""));
    let date = t ? t.date : preset.date;
    if (!t && !date) date = (type === "homework" || type === "test") && el.fClass.value ? nextLessonDate(el.fClass.value, todayISO()) : (tab === "plan" ? selected : todayISO());
    if (!t && DATELESS_TYPES.includes(type) && !preset.date) date = "";
    el.fDate.value = date || "";
    el.fTime.value = t ? t.time : "";
    el.fNotes.value = t ? t.notes : "";
    el.form.elements.priority.value = t ? t.priority : "med";
    el.deleteBtn.hidden = !t;
    updateTypeFields(); // also sets the reminder choices for this type
    el.fRemind.value = t ? (t.remind === null ? "off" : String(t.remind)) : (type === "test" ? "1440" : "0");
    if (!el.fRemind.value) el.fRemind.value = el.fRemind.options[0].value;
    el.sheet.showModal();
    if (!t) setTimeout(() => el.fTitle.focus(), 50);
  }

  function closeTaskSheet() { el.sheet.close(); editingId = null; }

  function saveTaskFromForm() {
    const type = currentType();
    let title = el.fTitle.value.trim();
    if (!title && type === "recover") title = recoverTitle(el.fClass.value);
    if (!title && type === "test") title = testTitle(el.fClass.value);
    if (!title) { el.fTitle.focus(); return; }
    if (!DATELESS_TYPES.includes(type) && !el.fDate.value) { el.fDate.focus(); return; }
    const data = {
      type,
      title,
      date: el.fDate.value || "",
      time: el.fTime.value || "",
      priority: type === "test" ? "high" : (el.form.elements.priority.value || "med"),
      notes: el.fNotes.value.trim(),
      remind: (el.fTime.value || type === "test") && el.fRemind.value !== "off" ? Number(el.fRemind.value) : null,
      grade: type === "test" ? el.fGrade.value.trim() : "",
      className: CLASS_TYPES.includes(type) ? el.fClass.value : "",
      missedDate: type === "recover" ? el.fMissed.value : "",
    };
    if (editingId) {
      const t = state.tasks.find((x) => x.id === editingId);
      if (t) Object.assign(t, data);
    } else {
      state.tasks.push(normalizeTask({ ...data, id: newId(), done: false, createdAt: Date.now() }));
      // Missed this lesson, or added its homework from the class: don't ask "What homework did you get?" about it
      if (type === "recover") markLessonAnswered(data.className, data.missedDate);
      if (type === "homework" && lessonContext) markLessonAnswered(data.className, lessonContext);
    }
    save();
    closeTaskSheet();
    if (tab === "plan" && data.date) selectDate(data.date); else render();
    if (!editingId && tab === "plan" && type !== "task") {
      toast({ homework: "Added to Homework", recover: "Added to To recover", test: "Added to Tests" }[type] || "Added to Long-term");
    }
    if ((data.time || type === "test") && data.remind !== null) ensureNotificationPermission();
  }

  function deleteTask(id) {
    const idx = state.tasks.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const [removed] = state.tasks.splice(idx, 1);
    save();
    closeTaskSheet();
    render();
    toast("Deleted", "Undo", () => { state.tasks.push(removed); save(); render(); });
  }

  function moveOverdueToToday() {
    const today = todayISO();
    let n = 0;
    state.tasks.forEach((t) => { if (t.type === "task" && !t.done && t.date && t.date < today) { t.date = today; n++; } });
    save();
    render();
    toast(`Moved ${n} task${n > 1 ? "s" : ""} to today`);
  }

  // ---------- Classes ----------
  function buildClassFormControls() {
    el.cDays.replaceChildren();
    DAY_NAMES.forEach((name, i) => {
      const l = document.createElement("label");
      l.innerHTML = `<input type="checkbox" value="${i}"><span></span>`;
      l.querySelector("span").textContent = name.slice(0, 3);
      l.querySelector("input").setAttribute("aria-label", name);
      l.querySelector("input").addEventListener("change", (e) => {
        // when editing, a class is one weekly slot, so days act like radio buttons
        if (editingClassId && e.target.checked) {
          el.cDays.querySelectorAll("input").forEach((x) => { if (x !== e.target) x.checked = false; });
        }
      });
      el.cDays.appendChild(l);
    });
    el.cColors.replaceChildren();
    CLASS_COLORS.forEach((c, i) => {
      const l = document.createElement("label");
      l.innerHTML = `<input type="radio" name="ccolor" value="${c}"><span></span>`;
      l.querySelector("span").style.background = c;
      l.querySelector("input").setAttribute("aria-label", `Colour ${i + 1}`);
      el.cColors.appendChild(l);
    });
  }

  function openClassSheet(id = null, preset = {}) {
    editingClassId = id;
    const c = id ? state.classes.find((x) => x.id === id) : null;
    el.classSheetTitle.textContent = c ? "Edit class" : "New class";
    el.cDaysLabel.innerHTML = c ? "Day" : "Days <em>(pick one or more)</em>";
    el.cName.value = c ? c.name : "";
    el.classNames.replaceChildren(...classNamesList().map((n) => new Option(n)));
    const day = c ? c.day : (preset.day !== undefined ? preset.day : weekdayIdx(new Date()));
    el.cDays.querySelectorAll("input").forEach((x) => { x.checked = Number(x.value) === day; });
    el.cStart.value = c ? c.start : "";
    el.cEnd.value = c ? c.end : "";
    el.cRoom.value = c ? c.room : "";
    const color = c ? c.color : CLASS_COLORS[state.classes.length % CLASS_COLORS.length];
    el.classForm.elements.ccolor.value = color;
    el.cHomework.checked = c ? c.homeworkCheck : false;
    el.classDeleteBtn.hidden = !c;
    el.classSheet.showModal();
    if (!c) setTimeout(() => el.cName.focus(), 50);
  }

  // Picking an existing class name re-uses its colour and settings
  el.cName.addEventListener("change", () => {
    if (editingClassId) return;
    const match = state.classes.find((c) => c.name.toLowerCase() === el.cName.value.trim().toLowerCase());
    if (match) {
      el.classForm.elements.ccolor.value = match.color;
      el.cHomework.checked = match.homeworkCheck;
      if (!el.cRoom.value) el.cRoom.value = match.room;
    }
  });

  function closeClassSheet() { el.classSheet.close(); editingClassId = null; }

  // ---------- Class actions (tap a class on the Planner) ----------
  let actionClass = null;
  function openClassActions(c) {
    actionClass = c;
    el.caTitle.textContent = c.name;
    el.caWhen.textContent = `${cap(relDay(selected))} · ${formatTime(c.start)}–${formatTime(c.end)}${c.room ? " · " + c.room : ""}`;
    el.classActions.showModal();
  }
  function testTitle(name) { return name ? `${name} test` : "Test"; }
  function recoverTitle(name) { return name ? `Catch up on ${name}` : "Catch up on a missed class"; }
  function addRecover(cls, missedDate, notes = "") {
    state.tasks.push(normalizeTask({
      id: newId(), type: "recover", title: recoverTitle(cls.name), className: cls.name, missedDate,
      date: "", time: "", priority: "med", notes, done: false, createdAt: Date.now(), remind: null,
    }));
  }

  function saveClassFromForm() {
    const name = el.cName.value.trim();
    if (!name) { el.cName.focus(); return; }
    const days = [...el.cDays.querySelectorAll("input:checked")].map((x) => Number(x.value));
    if (!days.length) { toast("Pick at least one day"); return; }
    const start = el.cStart.value, end = el.cEnd.value;
    if (!start || !end) { (start ? el.cEnd : el.cStart).focus(); return; }
    if (end <= start) { toast("The class has to end after it starts"); el.cEnd.focus(); return; }
    const base = {
      name, start, end,
      room: el.cRoom.value.trim(),
      color: el.classForm.elements.ccolor.value || CLASS_COLORS[0],
      homeworkCheck: el.cHomework.checked,
    };
    if (editingClassId) {
      const c = state.classes.find((x) => x.id === editingClassId);
      if (c) {
        const oldName = c.name;
        if (base.homeworkCheck && !c.homeworkCheck) c.checkSince = Date.now();
        Object.assign(c, base, { day: days[0] });
        // keep homework linked when a class is renamed
        if (oldName !== name) state.tasks.forEach((t) => { if (t.className === oldName) t.className = name; });
      }
    } else {
      for (const day of days) {
        state.classes.push(normalizeClass({ ...base, id: newId(), day, checkSince: Date.now(), createdAt: Date.now() }));
      }
    }
    save();
    closeClassSheet();
    render();
    const saved = state.classes.filter((c) => c.name === name && (editingClassId ? true : days.includes(c.day)));
    const clashes = [...new Set(saved.flatMap((c) => overlapsWith(c)).map((o) => o.name).filter((n) => n !== name))];
    if (clashes.length) toast(`Saved — runs at the same time as ${clashes.slice(0, 2).join(" and ")}`);
    if (base.homeworkCheck) ensureNotificationPermission();
  }

  function deleteClass(id) {
    const idx = state.classes.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const [removed] = state.classes.splice(idx, 1);
    save();
    closeClassSheet();
    render();
    toast("Class deleted", "Undo", () => { state.classes.push(removed); save(); render(); });
  }

  // ---------- Holiday / day-off sheet ----------
  let editingHolidayId = null;
  function openHolidaySheet(id = null) {
    editingHolidayId = id;
    const h = id ? state.holidays.find((x) => x.id === id) : null;
    el.holidayTitle.textContent = h ? "Edit holiday" : "Holiday or day off";
    el.hName.value = h ? h.name : "";
    el.hFrom.value = h ? h.from : todayISO();
    el.hTo.value = h ? h.to : todayISO();
    el.holidayDeleteBtn.hidden = !h;
    el.holidaySheet.showModal();
  }

  function saveHolidayFromForm() {
    const from = el.hFrom.value, to = el.hTo.value;
    if (!from) { el.hFrom.focus(); return; }
    if (!to) { el.hTo.focus(); return; }
    if (to < from) { toast("The last day has to be on or after the first day"); el.hTo.focus(); return; }
    const data = { name: el.hName.value.trim().slice(0, 60), from, to };
    if (editingHolidayId) {
      const h = state.holidays.find((x) => x.id === editingHolidayId);
      if (h) Object.assign(h, data);
    } else {
      state.holidays.push({ id: newId(), ...data });
    }
    save();
    el.holidaySheet.close();
    render();
    toast(from === to ? `${relDay(from) === "today" ? "Today" : cap(relDay(from))} is a day off — no class questions`
      : `No class questions until ${fmtShort.format(fromISO(to))}`);
  }

  function deleteHoliday(id) {
    const idx = state.holidays.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const [removed] = state.holidays.splice(idx, 1);
    save();
    el.holidaySheet.close();
    render();
    toast("Holiday removed", "Undo", () => { state.holidays.push(removed); save(); render(); });
  }

  // ---------- Homework check-in ("What homework did you get?") ----------
  function openHomeworkCheck(force = false) {
    const pending = pendingChecks().filter((p) => force || !hwSnoozed.has(p.key));
    if (!pending.length) { if (force) toast("All answered 👍"); return false; }
    if (anyDialogOpen()) { if (!force) return false; dialogs().forEach((d) => d.open && d.close()); }

    el.hwRows.replaceChildren();
    for (const p of pending) {
      const row = document.createElement("div");
      row.className = "hw-row";
      row.dataset.key = p.key;
      row.style.setProperty("--c", p.cls.color);
      row.innerHTML = `
        <div class="hw-row-head"><strong class="hw-class"></strong><span class="muted small hw-when"></span></div>
        <input class="hw-text" type="text" maxlength="200" placeholder="What's the homework?" autocomplete="off">
        <div class="hw-row-foot">
          <label class="hw-due"><span class="muted small">Due</span><input class="hw-date" type="date"></label>
        </div>
        <div class="hw-row-chips">
          <button class="chip hw-none" type="button" aria-pressed="false">No homework</button>
          <button class="chip hw-absent" type="button" aria-pressed="false">I was absent</button>
        </div>`;
      row.querySelector(".hw-class").textContent = p.cls.name;
      row.querySelector(".hw-when").textContent = `${cap(relDay(p.date))}, ${formatTime(p.cls.start)}–${formatTime(p.cls.end)}`;
      row.querySelector(".hw-text").setAttribute("aria-label", `Homework for ${p.cls.name}`);
      row.querySelector(".hw-date").value = nextLessonDate(p.cls.name, todayISO());
      const none = row.querySelector(".hw-none");
      const absent = row.querySelector(".hw-absent");
      const setState = (st) => { // "", "none" or "absent"
        none.setAttribute("aria-pressed", String(st === "none"));
        absent.setAttribute("aria-pressed", String(st === "absent"));
        row.dataset.state = st;
        row.classList.toggle("is-none", st !== "");
      };
      none.addEventListener("click", () => {
        setState(row.dataset.state === "none" ? "" : "none");
        if (row.dataset.state) row.querySelector(".hw-text").value = "";
      });
      absent.addEventListener("click", () => setState(row.dataset.state === "absent" ? "" : "absent"));
      row.querySelector(".hw-text").addEventListener("input", (e) => {
        if (e.target.value && row.dataset.state === "none") setState("");
      });
      setState("");
      el.hwRows.appendChild(row);
    }
    el.hwSheet.showModal();
    return true;
  }

  function addHomework(cls, text, due) {
    state.tasks.push(normalizeTask({
      id: newId(), type: "homework", title: text, className: cls.name,
      date: due || nextLessonDate(cls.name, todayISO()), time: "", priority: "med", notes: "",
      done: false, createdAt: Date.now(), remind: null,
    }));
  }

  function saveHomeworkCheck() {
    const pending = new Map(pendingChecks().map((p) => [p.key, p]));
    let added = 0, none = 0, left = 0, absent = 0;
    el.hwRows.querySelectorAll(".hw-row").forEach((row) => {
      const p = pending.get(row.dataset.key);
      if (!p) return;
      const text = row.querySelector(".hw-text").value.trim();
      const st = row.dataset.state;
      if (st === "absent") {
        // missed the class: add it to "To recover" (with any homework text as a note)
        addRecover(p.cls, p.date, text ? `Homework: ${text}` : "");
        state.hwAnswered[p.key] = Date.now(); absent++;
      }
      else if (text) { addHomework(p.cls, text, row.querySelector(".hw-date").value); state.hwAnswered[p.key] = Date.now(); added++; }
      else if (st === "none") { state.hwAnswered[p.key] = Date.now(); none++; }
      else { hwSnoozed.add(p.key); left++; }
    });
    save();
    el.hwSheet.close();
    render();
    const parts = [];
    if (added) parts.push(`Added ${added} homework`);
    if (absent) parts.push(`${absent} class${absent > 1 ? "es" : ""} to recover`);
    if (left) parts.push(`I'll ask again about ${left} class${left > 1 ? "es" : ""}`);
    toast(parts.join(" · ") || (none ? "Got it — no homework" : "Saved"));
  }

  function snoozeHomeworkCheck() {
    el.hwRows.querySelectorAll(".hw-row").forEach((row) => hwSnoozed.add(row.dataset.key));
    el.hwSheet.close();
    render();
  }

  /** Called when the app opens/resumes: ask about any classes we haven't heard about yet. */
  function maybeAskHomework() {
    if (anyDialogOpen()) return;
    openHomeworkCheck(false);
  }

  // ---------- Backup ----------
  const backupName = () => `planner-backup-${todayISO()}.json`;
  const backupJSON = () =>
    JSON.stringify({ app: "planner", version: 5, exportedAt: new Date().toISOString(), ...state }, null, 2);

  async function exportBackup() {
    if (Files) {
      try {
        await Files.writeFile({
          path: `Planner/${backupName()}`, data: backupJSON(),
          directory: "DOCUMENTS", encoding: "utf8", recursive: true,
        });
        el.menu.close();
        toast("Saved to Documents › Planner");
      } catch {
        shareBackup(); // fall back to the share sheet if the phone won't allow saving there
      }
      return;
    }
    const blob = new Blob([backupJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    el.menu.close();
    toast("Backup file saved");
  }

  async function shareBackup() {
    if (!Files || !Share) return;
    try {
      const res = await Files.writeFile({ path: backupName(), data: backupJSON(), directory: "CACHE", encoding: "utf8" });
      el.menu.close();
      await Share.share({ title: "Planner backup", files: [res.uri] });
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) toast("Couldn't share the backup");
    }
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.tasks)) throw new Error("bad file");
        const incoming = normalizeState(data);
        const haveT = new Set(state.tasks.map((t) => t.id));
        const haveC = new Set(state.classes.map((c) => c.id));
        const newTasks = incoming.tasks.filter((t) => !haveT.has(t.id));
        const newClasses = incoming.classes.filter((c) => !haveC.has(c.id));
        state.tasks.push(...newTasks);
        state.classes.push(...newClasses);
        Object.assign(state.hwAnswered, incoming.hwAnswered);
        const haveH = new Set(state.holidays.map((h) => h.id));
        state.holidays.push(...incoming.holidays.filter((h) => !haveH.has(h.id)));
        save();
        el.menu.close();
        render();
        const bits = [`${newTasks.length} task${newTasks.length === 1 ? "" : "s"}`];
        if (newClasses.length) bits.push(`${newClasses.length} class${newClasses.length === 1 ? "" : "es"}`);
        toast(`Restored ${bits.join(" and ")}`);
      } catch {
        toast("That file isn't a Planner backup");
      }
    };
    reader.readAsText(file);
  }

  function clearCompleted() {
    const kept = state.tasks.filter((t) => !t.done || t.type === "test"); // tests keep their grades
    const removed = state.tasks.length - kept.length;
    if (!removed) { toast("No completed tasks"); return; }
    if (!confirm(`Delete ${removed} completed item${removed > 1 ? "s" : ""}?`)) return;
    state.tasks = kept;
    save();
    el.menu.close();
    render();
    toast(`Deleted ${removed} item${removed > 1 ? "s" : ""}`);
  }

  // ---------- Notifications (Android app only) ----------
  function hashId(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return (h & 0x7fffffff) || 1;
  }

  function reminderAt(t) {
    // Tests without a time: day-before reminders come in the evening, "on the day" in the morning
    const base = t.time || (t.type === "test" ? (t.remind === 0 ? "07:30" : "18:00") : "09:00");
    return atTime(t.date, base).getTime() - t.remind * 60000;
  }

  function reminderBody(t) {
    if (t.type === "test") {
      const when = { 0: "Today", 1440: "Tomorrow", 2880: "In 2 days", 10080: "In 1 week" }[t.remind] || cap(relDay(t.date));
      return `${t.className ? t.className + " test" : "Test"} · ${when}${t.time ? " at " + formatTime(t.time) : ""}${t.notes ? " · " + t.notes.slice(0, 60) : ""}`;
    }
    const when = formatTime(t.time);
    const prefix = t.type === "homework" && t.className ? `${t.className} · ` : "";
    if (t.remind === 0) return `${prefix}Now · ${when}`;
    if (t.remind === 1440) return `${prefix}Tomorrow at ${when}`;
    if (t.remind >= 60) return `${prefix}In ${t.remind / 60} hour${t.remind > 60 ? "s" : ""} · ${when}`;
    return `${prefix}In ${t.remind} minutes · ${when}`;
  }

  async function ensureNotificationPermission() {
    if (!Notif) return false;
    try {
      let p = await Notif.checkPermissions();
      if (p.display === "prompt" || p.display === "prompt-with-rationale") p = await Notif.requestPermissions();
      const ok = p.display === "granted";
      if (!ok) toast("Turn on notifications for Planner in Settings to get reminders");
      else scheduleNotificationSync();
      return ok;
    } catch { return false; }
  }

  let syncTimer;
  function scheduleNotificationSync() {
    if (!Notif) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNotifications, 300);
  }

  async function syncNotifications() {
    try {
      const now = Date.now();
      const reminders = state.tasks
        .filter((t) => !t.done && t.date && (t.time || t.type === "test") && t.remind !== null)
        .map((t) => ({ t, at: reminderAt(t) }))
        .filter((x) => x.at > now + 1000)
        .sort((a, b) => a.at - b.at)
        .slice(0, 50) // Android limits how many alarms an app can hold
        .map(({ t, at }) => ({
          id: hashId(t.id),
          title: t.title,
          body: reminderBody(t),
          schedule: { at: new Date(at), allowWhileIdle: true },
          channelId: "reminders",
          smallIcon: "ic_stat_planner",
          iconColor: "#15803d",
          extra: { kind: "reminder", date: t.date, taskId: t.id },
        }));

      // A check-in when each lesson with "Weekly homework" ends, for the next few weeks.
      // One notification per lesson (not a weekly repeat) so holidays and days off can be skipped.
      // The list is rebuilt every time the app opens or anything changes.
      const checks = [];
      const hwClasses = state.classes.filter((c) => c.homeworkCheck);
      for (let i = 0; i < CHECK_HORIZON_DAYS && hwClasses.length; i++) {
        const iso = toISO(addDays(new Date(), i));
        if (holidayOn(iso)) continue;
        for (const c of hwClasses) {
          if (c.day !== weekdayIdx(fromISO(iso)) || state.hwAnswered[`${c.id}@${iso}`]) continue;
          const at = atTime(iso, c.end).getTime();
          if (at <= now + 1000) continue;
          checks.push({
            id: hashId(`hw:${c.id}@${iso}`),
            title: `Homework for ${c.name}?`,
            body: "Class is over. Did you get any homework?",
            schedule: { at: new Date(at), allowWhileIdle: true },
            channelId: "homework",
            actionTypeId: "HW_CHECK",
            smallIcon: "ic_stat_planner",
            iconColor: "#15803d",
            extra: { kind: "hwcheck", classId: c.id, date: iso },
          });
        }
      }
      checks.splice(MAX_CHECK_NOTIFICATIONS);
      if (checks.length) {
        // If the app isn't opened for weeks, the check-ins run out: remind to open it before that happens
        const lastAt = Math.max(...checks.map((n) => n.schedule.at.getTime()));
        checks.push({
          id: hashId("hw:keepalive"),
          title: "Keep your homework check-ins going",
          body: "Open Planner so it can plan the next weeks of after-class questions.",
          schedule: { at: new Date(lastAt - 864e5), allowWhileIdle: true },
          channelId: "homework",
          smallIcon: "ic_stat_planner",
          iconColor: "#15803d",
          extra: { kind: "keepalive" },
        });
      }

      const pending = await Notif.getPending();
      if (pending.notifications.length) {
        await Notif.cancel({ notifications: pending.notifications.map((n) => ({ id: Number(n.id) })) });
      }
      const all = [...reminders, ...checks];
      if (!all.length) return;
      const perm = await Notif.checkPermissions();
      if (perm.display !== "granted") return;
      await Notif.schedule({ notifications: all });
    } catch (e) {
      console.warn("Notification sync failed", e);
    }
  }

  function handleNotificationAction(a) {
    const n = (a && a.notification) || {};
    const extra = n.extra || {};
    if (extra.kind === "hwcheck") {
      const cls = state.classes.find((c) => c.id === extra.classId);
      if (!cls) return;
      const lesson = isISO(extra.date) ? extra.date : lastEndedLesson(cls);
      const key = `${cls.id}@${lesson}`;
      const text = (a.inputValue || "").trim();
      if (a.actionId === "none") {
        state.hwAnswered[key] = Date.now();
        save(); render();
        toast(`Got it — no homework for ${cls.name}`);
      } else if (a.actionId === "absent") {
        addRecover(cls, lesson);
        state.hwAnswered[key] = Date.now();
        save(); render();
        toast(`${cls.name} added to To recover`);
      } else if (a.actionId === "reply" && text) {
        addHomework(cls, text);
        state.hwAnswered[key] = Date.now();
        save(); render();
        toast(`Added homework for ${cls.name}`);
      } else {
        hwSnoozed.delete(key);
        setTab("homework");
        openHomeworkCheck(true);
      }
      return;
    }
    if (extra.date) { tab = "plan"; selectDate(extra.date); }
  }

  function setupNative() {
    if (!isNative) return;
    document.documentElement.classList.add("native");
    $("shareBtn").hidden = false;
    $("shareBtn").addEventListener("click", shareBackup);

    // Android back button: close sheets, then go back to Planner/today, then leave the app
    AppPlugin.addListener("backButton", () => {
      const open = dialogs().find((d) => d.open);
      if (open === el.sheet) closeTaskSheet();
      else if (open === el.classSheet) closeClassSheet();
      else if (open === el.hwSheet) snoozeHomeworkCheck();
      else if (open) open.close();
      else if (tab !== "plan") setTab("plan");
      else if (selected !== todayISO()) selectDate(todayISO());
      else AppPlugin.minimizeApp();
    });
    AppPlugin.addListener("resume", onResume);

    if (Notif) {
      Notif.createChannel({
        id: "reminders", name: "Task reminders", description: "Reminders for tasks you planned",
        importance: 4, visibility: 1, vibration: true,
      }).catch(() => {});
      Notif.createChannel({
        id: "homework", name: "Homework check-ins", description: "After class: did you get homework?",
        importance: 4, visibility: 1, vibration: true,
      }).catch(() => {});
      Notif.registerActionTypes({
        types: [{
          id: "HW_CHECK",
          actions: [
            { id: "reply", title: "Type homework", input: true, inputButtonTitle: "Save", inputPlaceholder: "What's the homework?" },
            { id: "none", title: "No homework" },
            { id: "absent", title: "I was absent" },
          ],
        }],
      }).catch(() => {});
      Notif.addListener("localNotificationActionPerformed", handleNotificationAction);
      scheduleNotificationSync();
    }
  }

  function setupDesktop() {
    if (!isDesktop) return;
    document.documentElement.classList.add("desktop");
    Notif.addListener("localNotificationActionPerformed", handleNotificationAction);
    scheduleNotificationSync();
  }

  // Keyboard shortcuts (PC): N = new, T = today, ←/→ = day, Ctrl+←/→ = week, 1–4 = tabs
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.metaKey || anyDialogOpen()) return;
    const target = e.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const tabKeys = { 1: "plan", 2: "timetable", 3: "homework", 4: "tests" };
    let handled = true;
    if ((e.key === "n" || e.key === "N") && !e.shiftKey) $("addBtn").click();
    else if ((e.key === "t" || e.key === "T") && !e.ctrlKey) { setTab("plan"); selectDate(todayISO()); }
    else if (tabKeys[e.key] && !e.ctrlKey) setTab(tabKeys[e.key]);
    else if (tab === "plan" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      if (e.ctrlKey) shiftWeek(dir);
      else selectDate(toISO(addDays(fromISO(selected), dir)));
    } else handled = false;
    if (handled) e.preventDefault();
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, actionLabel, action) {
    clearTimeout(toastTimer);
    el.toast.replaceChildren();
    const span = document.createElement("span");
    span.textContent = msg;
    el.toast.appendChild(span);
    if (actionLabel) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = actionLabel;
      b.addEventListener("click", () => { action(); el.toast.classList.remove("show"); });
      el.toast.appendChild(b);
    }
    el.toast.classList.add("show");
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), actionLabel ? 5000 : 2600);
  }

  // ---------- Events ----------
  $("addBtn").addEventListener("click", () => {
    if (tab === "timetable") openClassSheet();
    else openTaskSheet();
  });
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  el.todayBtn.addEventListener("click", () => selectDate(todayISO()));
  $("prevWeek").addEventListener("click", () => shiftWeek(-1));
  $("nextWeek").addEventListener("click", () => shiftWeek(1));
  $("moveOverdue").addEventListener("click", moveOverdueToToday);

  $("cancelBtn").addEventListener("click", closeTaskSheet);
  el.deleteBtn.addEventListener("click", () => editingId && deleteTask(editingId));
  el.form.addEventListener("submit", (e) => { e.preventDefault(); saveTaskFromForm(); });
  el.form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener("change", () => {
    updateTypeFields();
    if (!editingId) {
      const type = currentType();
      if ((type === "homework" || type === "test") && el.fClass.value) el.fDate.value = nextLessonDate(el.fClass.value, todayISO());
      if (type === "test" && el.fRemind.value === "0") el.fRemind.value = "1440";
      if (DATELESS_TYPES.includes(type)) el.fDate.value = "";
      if (type === "recover" && !el.fMissed.value && el.fClass.value) el.fMissed.value = lastLessonDate(el.fClass.value);
      if (type === "task" && !el.fDate.value) el.fDate.value = tab === "plan" ? selected : todayISO();
      el.sheetTitle.textContent = sheetTitleFor(type);
    }
  }));
  el.fClass.addEventListener("change", () => {
    if (editingId || !el.fClass.value) return;
    if (currentType() === "homework" || currentType() === "test") el.fDate.value = nextLessonDate(el.fClass.value, todayISO());
    if (currentType() === "recover") el.fMissed.value = lastLessonDate(el.fClass.value);
  });
  el.fTime.addEventListener("input", updateRemindField);
  el.fTime.addEventListener("change", updateRemindField);

  buildClassFormControls();
  $("classCancelBtn").addEventListener("click", closeClassSheet);
  el.classDeleteBtn.addEventListener("click", () => editingClassId && deleteClass(editingClassId));
  el.classForm.addEventListener("submit", (e) => { e.preventDefault(); saveClassFromForm(); });

  $("caHomework").addEventListener("click", () => {
    el.classActions.close();
    openTaskSheet(null, { type: "homework", className: actionClass.name, date: nextLessonDate(actionClass.name, selected), lessonDate: selected });
  });
  $("caMissed").addEventListener("click", () => {
    el.classActions.close();
    openTaskSheet(null, { type: "recover", className: actionClass.name, missedDate: selected });
  });
  $("caEdit").addEventListener("click", () => { el.classActions.close(); openClassSheet(actionClass.id); });
  $("caTest").addEventListener("click", () => {
    el.classActions.close();
    openTaskSheet(null, { type: "test", className: actionClass.name, date: nextLessonDate(actionClass.name, selected) });
  });
  $("caClose").addEventListener("click", () => el.classActions.close());

  el.holidayForm.addEventListener("submit", (e) => { e.preventDefault(); saveHolidayFromForm(); });
  $("holidayCancelBtn").addEventListener("click", () => el.holidaySheet.close());
  el.holidayDeleteBtn.addEventListener("click", () => editingHolidayId && deleteHoliday(editingHolidayId));
  el.holidaySheet.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    const today = new Date();
    el.hFrom.value = toISO(today);
    el.hTo.value = toISO(b.dataset.range === "week" ? addDays(today, 6 - weekdayIdx(today)) : addDays(today, Number(b.dataset.range)));
  }));

  el.hwForm.addEventListener("submit", (e) => { e.preventDefault(); saveHomeworkCheck(); });
  $("hwLaterBtn").addEventListener("click", snoozeHomeworkCheck);
  el.hwSheet.addEventListener("cancel", (e) => { e.preventDefault(); snoozeHomeworkCheck(); });

  $("menuBtn").addEventListener("click", () => el.menu.showModal());
  $("closeMenu").addEventListener("click", () => el.menu.close());
  $("exportBtn").addEventListener("click", exportBackup);
  $("importBtn").addEventListener("click", () => el.importFile.click());
  $("clearDoneBtn").addEventListener("click", clearCompleted);
  el.importFile.addEventListener("change", () => {
    const f = el.importFile.files[0];
    if (f) importBackup(f);
    el.importFile.value = "";
  });

  // Tap on the dim backdrop closes a sheet
  dialogs().forEach((dlg) => {
    dlg.addEventListener("click", (e) => {
      if (e.target !== dlg) return;
      if (dlg === el.hwSheet) snoozeHomeworkCheck();
      else if (dlg === el.sheet) closeTaskSheet();
      else if (dlg === el.classSheet) closeClassSheet();
      else dlg.close();
    });
  });

  // Swipe left/right on the week strip to change weeks
  let touchX = null, touchY = null;
  el.weekStrip.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  el.weekStrip.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftWeek(dx < 0 ? 1 : -1);
    touchX = touchY = null;
  }, { passive: true });

  // Coming back to the app: fix "today" after midnight and ask about unanswered homework again
  let lastToday = todayISO();
  function onResume() {
    if (todayISO() !== lastToday) {
      if (selected === lastToday) selected = todayISO();
      lastToday = todayISO();
      weekStart = startOfWeek(fromISO(selected));
    }
    hwSnoozed = new Set();
    render();
    maybeAskHomework();
  }
  let wasHidden = false;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") wasHidden = true;
    else if (wasHidden) { wasHidden = false; onResume(); }
  });

  // While the app is open, notice when a class ends
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    renderHwPrompts();
    maybeAskHomework();
  }, 60000);

  // Sync if the app is open in two tabs (web version)
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) { state = load(); render(); }
  });

  // Ask the browser not to clear our data when space is low
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Offline support for the web version
  if (!isNative && "serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  setupNative();
  setupDesktop();
  render();
  setTimeout(maybeAskHomework, 400);
})();
