/* Planner — a private, offline planner.
 * All data is kept in this browser's localStorage on the phone. Nothing is sent anywhere.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "planner.v1";
  const PRIORITY_RANK = { high: 0, med: 1, low: 2 };
  const PRIORITY_LABEL = { high: "High", med: "Medium", low: "Low" };

  // ---------- Dates (always local time) ----------
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayISO = () => toISO(new Date());
  const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7)); // weeks start Monday

  const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const fmtDow = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  function formatTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return fmtTime.format(new Date(2000, 0, 1, h, m));
  }

  // ---------- Storage ----------
  let memoryFallback = null; // used if localStorage is blocked (e.g. private mode)

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { tasks: [] };
      const data = JSON.parse(raw);
      return { tasks: Array.isArray(data.tasks) ? data.tasks.filter(isValidTask) : [] };
    } catch {
      return memoryFallback || { tasks: [] };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      memoryFallback = state;
      toast("Couldn't save — storage is blocked on this browser");
    }
  }

  function isValidTask(t) {
    return t && typeof t.id === "string" && typeof t.title === "string" &&
      typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
  }

  function normalizeTask(t) {
    return {
      id: t.id,
      title: String(t.title).slice(0, 200),
      date: t.date,
      time: typeof t.time === "string" && /^\d{2}:\d{2}$/.test(t.time) ? t.time : "",
      priority: PRIORITY_RANK[t.priority] !== undefined ? t.priority : "med",
      notes: typeof t.notes === "string" ? t.notes.slice(0, 2000) : "",
      done: !!t.done,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
    };
  }

  const newId = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---------- State ----------
  let state = load();
  state.tasks = state.tasks.map(normalizeTask);
  let selected = todayISO();
  let weekStart = startOfWeek(fromISO(selected));
  let editingId = null;

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    monthLabel: $("monthLabel"), weekStrip: $("weekStrip"),
    dayLabel: $("dayLabel"), progressText: $("progressText"), progressBar: $("progressBar"),
    overdue: $("overdue"), overdueText: $("overdueText"),
    list: $("taskList"), empty: $("empty"),
    sheet: $("taskSheet"), form: $("taskForm"), sheetTitle: $("sheetTitle"),
    fTitle: $("fTitle"), fDate: $("fDate"), fTime: $("fTime"), fNotes: $("fNotes"),
    deleteBtn: $("deleteBtn"), menu: $("menuSheet"), importFile: $("importFile"), toast: $("toast"),
  };

  // ---------- Rendering ----------
  function tasksOn(iso) {
    return state.tasks
      .filter((t) => t.date === iso)
      .sort((a, b) =>
        (a.done - b.done) ||
        ((a.time || "99:99").localeCompare(b.time || "99:99")) ||
        (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) ||
        (a.createdAt - b.createdAt));
  }

  function renderWeek() {
    const today = todayISO();
    const datesWithTasks = new Set(state.tasks.filter((t) => !t.done).map((t) => t.date));
    el.monthLabel.textContent = fmtMonth.format(addDays(weekStart, 3));
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
    const rel = selected === today ? "Today · " :
      selected === toISO(addDays(new Date(), 1)) ? "Tomorrow · " :
      selected === toISO(addDays(new Date(), -1)) ? "Yesterday · " : "";
    el.dayLabel.textContent = rel + fmtDay.format(d);

    const tasks = tasksOn(selected);
    const done = tasks.filter((t) => t.done).length;
    el.progressText.textContent = tasks.length
      ? (done === tasks.length ? `All ${tasks.length} done 🎉` : `${done} of ${tasks.length} done`)
      : "No tasks";
    el.progressBar.style.width = tasks.length ? `${(done / tasks.length) * 100}%` : "0";

    // Overdue banner only on today
    const overdue = selected === today ? state.tasks.filter((t) => !t.done && t.date < today) : [];
    el.overdue.hidden = overdue.length === 0;
    if (overdue.length) {
      el.overdueText.textContent = `${overdue.length} unfinished task${overdue.length > 1 ? "s" : ""} from earlier days`;
    }

    el.list.replaceChildren(...tasks.map(renderTask));
    el.empty.hidden = tasks.length > 0;
  }

  function renderTask(t) {
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
    const bits = [];
    if (t.time) bits.push("🕒 " + formatTime(t.time));
    bits.push(PRIORITY_LABEL[t.priority] + " priority");
    bits.forEach((s) => { const span = document.createElement("span"); span.textContent = s; meta.appendChild(span); });
    if (t.notes) {
      const n = document.createElement("div");
      n.className = "task-notes";
      n.textContent = t.notes;
      li.querySelector(".task-body").appendChild(n);
    }
    li.querySelector(".task-body").addEventListener("click", () => openSheet(t.id));
    return li;
  }

  function render() { renderWeek(); renderDay(); }

  // ---------- Actions ----------
  function selectDate(iso) {
    selected = iso;
    const ws = startOfWeek(fromISO(iso));
    if (toISO(ws) !== toISO(weekStart)) weekStart = ws;
    render();
  }

  function shiftWeek(n) {
    weekStart = addDays(weekStart, 7 * n);
    // keep the same weekday selected in the new week
    selected = toISO(addDays(fromISO(selected), 7 * n));
    render();
  }

  function toggleDone(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    save();
    render();
    if (t.done && navigator.vibrate) navigator.vibrate(15);
  }

  function openSheet(id = null) {
    editingId = id;
    const t = id ? state.tasks.find((x) => x.id === id) : null;
    el.sheetTitle.textContent = t ? "Edit task" : "New task";
    el.fTitle.value = t ? t.title : "";
    el.fDate.value = t ? t.date : selected;
    el.fTime.value = t ? t.time : "";
    el.fNotes.value = t ? t.notes : "";
    el.form.elements.priority.value = t ? t.priority : "med";
    el.deleteBtn.hidden = !t;
    el.sheet.showModal();
    if (!t) setTimeout(() => el.fTitle.focus(), 50);
  }

  function closeSheet() { el.sheet.close(); editingId = null; }

  function saveFromForm() {
    const title = el.fTitle.value.trim();
    if (!title) { el.fTitle.focus(); return; }
    const data = {
      title,
      date: el.fDate.value || selected,
      time: el.fTime.value || "",
      priority: el.form.elements.priority.value || "med",
      notes: el.fNotes.value.trim(),
    };
    if (editingId) {
      const t = state.tasks.find((x) => x.id === editingId);
      if (t) Object.assign(t, data);
    } else {
      state.tasks.push(normalizeTask({ ...data, id: newId(), done: false, createdAt: Date.now() }));
    }
    save();
    closeSheet();
    selectDate(data.date);
  }

  function deleteTask(id) {
    const idx = state.tasks.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const [removed] = state.tasks.splice(idx, 1);
    save();
    closeSheet();
    render();
    toast("Task deleted", "Undo", () => {
      state.tasks.push(removed);
      save();
      render();
    });
  }

  function moveOverdueToToday() {
    const today = todayISO();
    let n = 0;
    state.tasks.forEach((t) => { if (!t.done && t.date < today) { t.date = today; n++; } });
    save();
    render();
    toast(`Moved ${n} task${n > 1 ? "s" : ""} to today`);
  }

  function clearCompleted() {
    const before = state.tasks.length;
    const kept = state.tasks.filter((t) => !t.done);
    const removed = before - kept.length;
    if (!removed) { toast("No completed tasks"); return; }
    if (!confirm(`Delete ${removed} completed task${removed > 1 ? "s" : ""}?`)) return;
    state.tasks = kept;
    save();
    el.menu.close();
    render();
    toast(`Deleted ${removed} task${removed > 1 ? "s" : ""}`);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ app: "planner", version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `planner-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    el.menu.close();
    toast("Backup file saved");
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.tasks)) throw new Error("bad file");
        const incoming = data.tasks.filter(isValidTask).map(normalizeTask);
        const existing = new Set(state.tasks.map((t) => t.id));
        const added = incoming.filter((t) => !existing.has(t.id));
        state.tasks.push(...added);
        save();
        el.menu.close();
        render();
        toast(`Restored ${added.length} task${added.length === 1 ? "" : "s"}`);
      } catch {
        toast("That file isn't a Planner backup");
      }
    };
    reader.readAsText(file);
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
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), actionLabel ? 5000 : 2200);
  }

  // ---------- Events ----------
  $("addBtn").addEventListener("click", () => openSheet());
  $("todayBtn").addEventListener("click", () => selectDate(todayISO()));
  $("prevWeek").addEventListener("click", () => shiftWeek(-1));
  $("nextWeek").addEventListener("click", () => shiftWeek(1));
  $("cancelBtn").addEventListener("click", closeSheet);
  $("moveOverdue").addEventListener("click", moveOverdueToToday);
  el.deleteBtn.addEventListener("click", () => editingId && deleteTask(editingId));
  el.form.addEventListener("submit", (e) => { e.preventDefault(); saveFromForm(); });

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
  [el.sheet, el.menu].forEach((dlg) => {
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
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

  // Keep "today" correct if the app stays open past midnight
  let lastToday = todayISO();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && todayISO() !== lastToday) {
      if (selected === lastToday) selected = todayISO();
      lastToday = todayISO();
      weekStart = startOfWeek(fromISO(selected));
      render();
    }
  });

  // Sync if the app is open in two tabs
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) { state = load(); state.tasks = state.tasks.map(normalizeTask); render(); }
  });

  // Ask the browser not to clear our data when space is low
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Offline support
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  render();
})();
