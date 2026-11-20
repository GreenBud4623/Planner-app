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
  const TYPES = ["task", "homework", "longterm"];
  const CLASS_COLORS = ["#4f46e5", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#db2777", "#7c3aed", "#64748b"];
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const CHECK_LOOKBACK_DAYS = 7; // only ask about classes from the last week

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
  const Notif = plugin("LocalNotifications");
  const AppPlugin = plugin("App");
  const Haptics = plugin("Haptics");
  const Files = plugin("Filesystem");
  const Share = plugin("Share");

  // ---------- Storage ----------
  let memoryFallback = null; // used if localStorage is blocked (e.g. private mode)

  function emptyState() { return { tasks: [], classes: [], hwAnswered: {} }; }

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
    return s;
  }

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
      (isISO(t.date) || (t.type === "longterm" && !t.date));
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
      className: type === "homework" && typeof t.className === "string" ? t.className.slice(0, 80) : "",
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
    classSheet: $("classSheet"), classForm: $("classForm"), classSheetTitle: $("classSheetTitle"),
    cName: $("cName"), classNames: $("classNames"), cDays: $("cDays"), cDaysLabel: $("cDaysLabel"),
    cStart: $("cStart"), cEnd: $("cEnd"), cRoom: $("cRoom"), cColors: $("cColors"), cHomework: $("cHomework"),
    classDeleteBtn: $("classDeleteBtn"),
    hwSheet: $("hwSheet"), hwForm: $("hwForm"), hwRows: $("hwRows"),
    menu: $("menuSheet"), importFile: $("importFile"), toast: $("toast"),
  };
  const dialogs = () => [el.sheet, el.classSheet, el.hwSheet, el.menu];
  const anyDialogOpen = () => dialogs().some((d) => d.open);

  // ---------- Classes helpers ----------
  const classesOn = (dayIdx) => state.classes.filter((c) => c.day === dayIdx).sort((a, b) => a.start.localeCompare(b.start));
  const classNamesList = () => [...new Set(state.classes.map((c) => c.name))].sort((a, b) => a.localeCompare(b));
  const classColor = (name) => (state.classes.find((c) => c.name === name) || {}).color || "var(--muted)";

  /** Date (ISO) of the next lesson of a class with this name, strictly after `afterISO`. */
  function nextLessonDate(name, afterISO) {
    const days = new Set(state.classes.filter((c) => c.name === name).map((c) => c.day));
    if (!days.size) return toISO(addDays(fromISO(afterISO), 1));
    for (let i = 1; i <= 7; i++) {
      const d = addDays(fromISO(afterISO), i);
      if (days.has(weekdayIdx(d))) return toISO(d);
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
        if (end > now || end.getTime() < c.checkSince) continue;
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
    li.innerHTML = `
      <button class="check" type="button">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="task-body" type="button">
        <div class="task-title"></div>
        <div class="task-meta"></div>
      </button>`;
    const check = li.querySelector(".check");
    check.setAttribute("aria-label", t.done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`);
    check.setAttribute("aria-pressed", String(t.done));
    check.addEventListener("click", () => toggleDone(t.id));

    li.querySelector(".task-title").textContent = t.title;
    const meta = li.querySelector(".task-meta");
    const add = (text, cls) => { const s = document.createElement("span"); s.textContent = text; if (cls) s.className = cls; meta.appendChild(s); return s; };

    if (t.type === "homework") {
      const tag = add(t.className || "Homework", "tag");
      tag.style.setProperty("--tag", classColor(t.className));
    } else if (t.type === "longterm") {
      add("Long-term", "tag tag-long");
    }
    if (opts.showDate && t.date) {
      const diff = dayDiff(t.date);
      const word = t.type === "longterm" ? "Deadline" : t.type === "homework" ? "Due" : "";
      if (!t.done && diff < 0) add(`${-diff} day${diff < -1 ? "s" : ""} late`, "late");
      else add(word ? `${word} ${relDay(t.date)}` : cap(relDay(t.date)));
    } else if (opts.showDate && t.type === "longterm") {
      add("No deadline");
    }
    if (t.time) add("🕒 " + formatTime(t.time) + (isNative && t.remind !== null && !t.done ? " 🔔" : ""));
    if (!opts.showDate && t.type === "longterm") add("Deadline");
    if (t.priority !== "med" || t.type === "task") add(PRIORITY_LABEL[t.priority] + " priority");

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
    ["plan", "timetable", "homework"].forEach((v) => { $("view-" + v).hidden = v !== tab; });
    el.weekBar.hidden = tab !== "plan";
    el.todayBtn.hidden = tab !== "plan";
    $("addBtn").setAttribute("aria-label", tab === "timetable" ? "Add class" : tab === "homework" ? "Add homework" : "Add task");

    const pastDue = pastDueItems().length;
    el.hwBadge.hidden = pastDue === 0;
    el.hwBadge.textContent = pastDue > 9 ? "9+" : String(pastDue);

    renderHwPrompts();
    if (tab === "plan") { renderWeek(); renderDay(); }
    else if (tab === "timetable") renderTimetable();
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

    // Classes on this day
    const classes = classesOn(weekdayIdx(d));
    el.dayClasses.hidden = classes.length === 0;
    el.dayClasses.replaceChildren();
    if (classes.length) {
      const h = document.createElement("h3");
      h.className = "section-title";
      h.textContent = "Classes";
      el.dayClasses.appendChild(h);
      const now = new Date();
      for (const c of classes) {
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
        row.querySelector(".class-row-main").addEventListener("click", () => openClassSheet(c.id));
        const hb = row.querySelector(".mini-btn");
        hb.setAttribute("aria-label", `Add homework for ${c.name}`);
        hb.addEventListener("click", () => openTaskSheet(null, { type: "homework", className: c.name, date: nextLessonDate(c.name, selected) }));
        el.dayClasses.appendChild(row);
      }
    }

    el.list.replaceChildren(...tasks.map((t) => renderTask(t)));
    el.empty.hidden = tasks.length > 0 || classes.length > 0;
  }

  // ---------- Rendering: Timetable ----------
  function renderTimetable() {
    el.pageTitle.textContent = "Timetable";
    el.ttIntro.hidden = state.classes.length > 0;
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
      for (const c of classes) {
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
        b.querySelector(".cc-meta").textContent = meta.join(" · ");
        b.addEventListener("click", () => openClassSheet(c.id));
        sec.appendChild(b);
      }
      el.ttList.appendChild(sec);
    }
  }

  // ---------- Rendering: Homework & long-term ----------
  function pastDueItems() {
    const today = todayISO();
    return state.tasks.filter((t) => !t.done && t.date && t.date < today);
  }

  function renderHomework() {
    el.pageTitle.textContent = "Homework";
    const today = todayISO();
    const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || sortTasks(a, b);
    const pastDue = pastDueItems().sort(byDate);
    const homework = state.tasks.filter((t) => t.type === "homework" && !t.done && t.date >= today).sort(byDate);
    const longterm = state.tasks.filter((t) => t.type === "longterm" && !t.done && (!t.date || t.date >= today)).sort(byDate);
    const doneRecently = state.tasks
      .filter((t) => t.done && t.type !== "task" && (!t.date || dayDiff(t.date) >= -14))
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
    section("Homework", homework, "No homework due. 🎉");
    section("Long-term", longterm, "Projects, revision or anything that takes a while. Tap + and pick Long-term.");
    if (doneRecently.length) section("Done recently", doneRecently, "");
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
    el.classField.hidden = type !== "homework";
    el.fTitleLabel.textContent = type === "homework" ? "Homework" : type === "longterm" ? "Long-term task" : "Task";
    el.fTitle.placeholder = type === "homework" ? "e.g. Exercises 1–5, page 42" :
      type === "longterm" ? "e.g. History project" : "What do you need to do?";
    el.fDateLabel.innerHTML = type === "homework" ? "Due date" : type === "longterm" ? "Deadline <em>(optional)</em>" : "Date";
    el.fDate.required = type !== "longterm";
  }

  function updateRemindField() {
    el.remindField.hidden = !(isNative && el.fTime.value);
  }

  function openTaskSheet(id = null, preset = {}) {
    editingId = id;
    const t = id ? state.tasks.find((x) => x.id === id) : null;
    const type = t ? t.type : preset.type || (tab === "homework" ? "homework" : "task");
    el.form.elements.type.value = type;
    el.sheetTitle.textContent = t ? "Edit" : type === "homework" ? "New homework" : type === "longterm" ? "New long-term task" : "New task";
    el.fTitle.value = t ? t.title : "";
    fillClassSelect(t ? t.className : preset.className);
    let date = t ? t.date : preset.date;
    if (!t && !date) date = type === "homework" && el.fClass.value ? nextLessonDate(el.fClass.value, todayISO()) : (tab === "plan" ? selected : todayISO());
    if (!t && type === "longterm" && !preset.date) date = "";
    el.fDate.value = date || "";
    el.fTime.value = t ? t.time : "";
    el.fNotes.value = t ? t.notes : "";
    el.form.elements.priority.value = t ? t.priority : "med";
    el.fRemind.value = t ? (t.remind === null ? "off" : String(t.remind)) : "0";
    if (!el.fRemind.value) el.fRemind.value = "0";
    el.deleteBtn.hidden = !t;
    updateTypeFields();
    updateRemindField();
    el.sheet.showModal();
    if (!t) setTimeout(() => el.fTitle.focus(), 50);
  }

  function closeTaskSheet() { el.sheet.close(); editingId = null; }

  function saveTaskFromForm() {
    const title = el.fTitle.value.trim();
    if (!title) { el.fTitle.focus(); return; }
    const type = currentType();
    if (type !== "longterm" && !el.fDate.value) { el.fDate.focus(); return; }
    const data = {
      type,
      title,
      date: el.fDate.value || "",
      time: el.fTime.value || "",
      priority: el.form.elements.priority.value || "med",
      notes: el.fNotes.value.trim(),
      remind: el.fTime.value && el.fRemind.value !== "off" ? Number(el.fRemind.value) : null,
      className: type === "homework" ? el.fClass.value : "",
    };
    if (editingId) {
      const t = state.tasks.find((x) => x.id === editingId);
      if (t) Object.assign(t, data);
    } else {
      state.tasks.push(normalizeTask({ ...data, id: newId(), done: false, createdAt: Date.now() }));
    }
    save();
    closeTaskSheet();
    if (tab === "plan" && data.date) selectDate(data.date); else render();
    if (!editingId && tab === "plan" && type !== "task") toast(type === "homework" ? "Added to Homework" : "Added to Long-term");
    if (data.time && data.remind !== null) ensureNotificationPermission();
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
          <button class="chip hw-none" type="button" aria-pressed="false">No homework</button>
        </div>`;
      row.querySelector(".hw-class").textContent = p.cls.name;
      row.querySelector(".hw-when").textContent = `${cap(relDay(p.date))}, ${formatTime(p.cls.start)}–${formatTime(p.cls.end)}`;
      row.querySelector(".hw-text").setAttribute("aria-label", `Homework for ${p.cls.name}`);
      row.querySelector(".hw-date").value = nextLessonDate(p.cls.name, todayISO());
      const none = row.querySelector(".hw-none");
      none.addEventListener("click", () => {
        const on = none.getAttribute("aria-pressed") !== "true";
        none.setAttribute("aria-pressed", String(on));
        row.classList.toggle("is-none", on);
        if (on) row.querySelector(".hw-text").value = "";
      });
      row.querySelector(".hw-text").addEventListener("input", (e) => {
        if (e.target.value && none.getAttribute("aria-pressed") === "true") {
          none.setAttribute("aria-pressed", "false"); row.classList.remove("is-none");
        }
      });
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
    let added = 0, none = 0, left = 0;
    el.hwRows.querySelectorAll(".hw-row").forEach((row) => {
      const p = pending.get(row.dataset.key);
      if (!p) return;
      const text = row.querySelector(".hw-text").value.trim();
      const isNone = row.querySelector(".hw-none").getAttribute("aria-pressed") === "true";
      if (text) { addHomework(p.cls, text, row.querySelector(".hw-date").value); state.hwAnswered[p.key] = Date.now(); added++; }
      else if (isNone) { state.hwAnswered[p.key] = Date.now(); none++; }
      else { hwSnoozed.add(p.key); left++; }
    });
    save();
    el.hwSheet.close();
    render();
    const parts = [];
    if (added) parts.push(`Added ${added} homework`);
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
    JSON.stringify({ app: "planner", version: 2, exportedAt: new Date().toISOString(), ...state }, null, 2);

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
    const kept = state.tasks.filter((t) => !t.done);
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

  function reminderAt(t) { return atTime(t.date, t.time).getTime() - t.remind * 60000; }

  function reminderBody(t) {
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
        .filter((t) => !t.done && t.date && t.time && t.remind !== null)
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
          iconColor: "#4f46e5",
          extra: { kind: "reminder", date: t.date, taskId: t.id },
        }));

      // One weekly repeating check-in per class with "Weekly homework", fired when the class ends.
      const checks = state.classes.filter((c) => c.homeworkCheck).slice(0, 40).map((c) => {
        const [hour, minute] = c.end.split(":").map(Number);
        return {
          id: hashId("hw:" + c.id),
          title: `Homework for ${c.name}?`,
          body: "Class is over. Did you get any homework?",
          // Capacitor weekdays: Sunday = 1 … Saturday = 7
          schedule: { on: { weekday: ((c.day + 1) % 7) + 1, hour, minute }, allowWhileIdle: true },
          channelId: "homework",
          actionTypeId: "HW_CHECK",
          smallIcon: "ic_stat_planner",
          iconColor: "#4f46e5",
          extra: { kind: "hwcheck", classId: c.id },
        };
      });

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
      const key = `${cls.id}@${lastEndedLesson(cls)}`;
      const text = (a.inputValue || "").trim();
      if (a.actionId === "none") {
        state.hwAnswered[key] = Date.now();
        save(); render();
        toast(`Got it — no homework for ${cls.name}`);
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
          ],
        }],
      }).catch(() => {});
      Notif.addListener("localNotificationActionPerformed", handleNotificationAction);
      scheduleNotificationSync();
    }
  }

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
      if (type === "homework" && el.fClass.value) el.fDate.value = nextLessonDate(el.fClass.value, todayISO());
      if (type === "longterm") el.fDate.value = "";
      if (type === "task" && !el.fDate.value) el.fDate.value = tab === "plan" ? selected : todayISO();
      el.sheetTitle.textContent = type === "homework" ? "New homework" : type === "longterm" ? "New long-term task" : "New task";
    }
  }));
  el.fClass.addEventListener("change", () => {
    if (!editingId && el.fClass.value) el.fDate.value = nextLessonDate(el.fClass.value, todayISO());
  });
  el.fTime.addEventListener("input", updateRemindField);
  el.fTime.addEventListener("change", updateRemindField);

  buildClassFormControls();
  $("classCancelBtn").addEventListener("click", closeClassSheet);
  el.classDeleteBtn.addEventListener("click", () => editingClassId && deleteClass(editingClassId));
  el.classForm.addEventListener("submit", (e) => { e.preventDefault(); saveClassFromForm(); });

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
  render();
  setTimeout(maybeAskHomework, 400);
})();
