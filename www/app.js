/* Planner — a private, offline planner.
 * All data is kept on the phone (WebView/browser localStorage). Nothing is sent anywhere.
 * When running as the Android app (Capacitor), it also uses native reminders, haptics,
 * the back button and file saving.
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
    scheduleReminderSync();
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
      // minutes before the task time to remind; null = no reminder
      remind: Number.isFinite(t.remind) && t.remind >= 0 ? t.remind : null,
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
    fRemind: $("fRemind"), remindField: $("remindField"),
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
    if (t.time) bits.push("🕒 " + formatTime(t.time) + (isNative && t.remind !== null && !t.done ? " 🔔" : ""));
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
    if (t.done) {
      if (Haptics) Haptics.impact({ style: "LIGHT" }).catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(15);
    }
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
    el.fRemind.value = t ? (t.remind === null ? "off" : String(t.remind)) : "0";
    if (!el.fRemind.value) el.fRemind.value = "0";
    updateRemindField();
    el.deleteBtn.hidden = !t;
    el.sheet.showModal();
    if (!t) setTimeout(() => el.fTitle.focus(), 50);
  }

  function closeSheet() { el.sheet.close(); editingId = null; }

  function updateRemindField() {
    el.remindField.hidden = !(isNative && el.fTime.value);
  }

  function saveFromForm() {
    const title = el.fTitle.value.trim();
    if (!title) { el.fTitle.focus(); return; }
    const data = {
      title,
      date: el.fDate.value || selected,
      time: el.fTime.value || "",
      priority: el.form.elements.priority.value || "med",
      notes: el.fNotes.value.trim(),
      remind: el.fTime.value && el.fRemind.value !== "off" ? Number(el.fRemind.value) : null,
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
    if (data.time && data.remind !== null) ensureNotificationPermission();
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

  const backupName = () => `planner-backup-${todayISO()}.json`;
  const backupJSON = () =>
    JSON.stringify({ app: "planner", version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);

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

  // ---------- Reminders (Android app only) ----------
  function hashId(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return (h & 0x7fffffff) || 1;
  }

  function reminderAt(t) {
    const [h, m] = t.time.split(":").map(Number);
    const d = fromISO(t.date);
    d.setHours(h, m, 0, 0);
    return d.getTime() - t.remind * 60000;
  }

  function reminderBody(t) {
    const when = formatTime(t.time);
    if (t.remind === 0) return `Now · ${when}`;
    if (t.remind === 1440) return `Tomorrow at ${when}`;
    if (t.remind >= 60) return `In ${t.remind / 60} hour${t.remind > 60 ? "s" : ""} · ${when}`;
    return `In ${t.remind} minutes · ${when}`;
  }

  let notifAllowed = false;
  async function ensureNotificationPermission() {
    if (!Notif) return false;
    try {
      let p = await Notif.checkPermissions();
      if (p.display === "prompt" || p.display === "prompt-with-rationale") p = await Notif.requestPermissions();
      notifAllowed = p.display === "granted";
      if (!notifAllowed) toast("Turn on notifications for Planner in Settings to get reminders");
      else scheduleReminderSync();
      return notifAllowed;
    } catch { return false; }
  }

  let syncTimer;
  function scheduleReminderSync() {
    if (!Notif) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncReminders, 300);
  }

  async function syncReminders() {
    try {
      const now = Date.now();
      const due = state.tasks
        .filter((t) => !t.done && t.time && t.remind !== null)
        .map((t) => ({ t, at: reminderAt(t) }))
        .filter((x) => x.at > now + 1000)
        .sort((a, b) => a.at - b.at)
        .slice(0, 60); // Android limits how many alarms an app can hold
      const pending = await Notif.getPending();
      if (pending.notifications.length) {
        await Notif.cancel({ notifications: pending.notifications.map((n) => ({ id: Number(n.id) })) });
      }
      if (!due.length) return;
      const perm = await Notif.checkPermissions();
      if (perm.display !== "granted") return;
      await Notif.schedule({
        notifications: due.map(({ t, at }) => ({
          id: hashId(t.id),
          title: t.title,
          body: reminderBody(t),
          schedule: { at: new Date(at), allowWhileIdle: true },
          channelId: "reminders",
          smallIcon: "ic_stat_planner",
          iconColor: "#4f46e5",
          extra: { date: t.date, taskId: t.id },
        })),
      });
    } catch (e) {
      console.warn("Reminder sync failed", e);
    }
  }

  function setupNative() {
    if (!isNative) return;
    document.documentElement.classList.add("native");
    $("shareBtn").hidden = false;
    $("shareBtn").addEventListener("click", shareBackup);

    // Android back button: close sheets first, then go back to today, then leave the app
    AppPlugin.addListener("backButton", () => {
      if (el.sheet.open) closeSheet();
      else if (el.menu.open) el.menu.close();
      else if (selected !== todayISO()) selectDate(todayISO());
      else AppPlugin.minimizeApp();
    });

    if (Notif) {
      Notif.createChannel({
        id: "reminders", name: "Task reminders", description: "Reminders for tasks you planned",
        importance: 4, visibility: 1, vibration: true,
      }).catch(() => {});
      // Tapping a reminder opens the app on that task's day
      Notif.addListener("localNotificationActionPerformed", (a) => {
        const date = a && a.notification && a.notification.extra && a.notification.extra.date;
        if (date) selectDate(date);
      });
      scheduleReminderSync();
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
  el.fTime.addEventListener("input", updateRemindField);
  el.fTime.addEventListener("change", updateRemindField);

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
  if (!isNative && "serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  setupNative();
  render();
})();
