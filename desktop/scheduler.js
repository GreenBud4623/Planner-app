// Works out which scheduled notifications are due. Uses the same shapes as
// Capacitor LocalNotifications, so www/app.js needs no PC-specific scheduling code:
//   { schedule: { at: Date | string | number } }                       one-off
//   { schedule: { on: { weekday: 1..7 (Sunday = 1), hour, minute } } } every week

/** Time (ms) of a notification's most recent occurrence at or before `now`, or null. */
function lastOccurrence(n, now) {
  const s = (n && n.schedule) || {};
  if (s.at != null) {
    const at = new Date(s.at).getTime();
    return Number.isFinite(at) && at <= now ? at : null;
  }
  if (s.on && Number.isInteger(s.on.weekday)) {
    const d = new Date(now);
    d.setHours(s.on.hour || 0, s.on.minute || 0, 0, 0);
    const jsDay = s.on.weekday - 1; // JS: Sunday = 0
    d.setDate(d.getDate() - ((d.getDay() - jsDay + 7) % 7));
    if (d.getTime() > now) d.setDate(d.getDate() - 7);
    return d.getTime();
  }
  return null;
}

/** Notifications whose occurrence falls in (from, to]. */
function dueBetween(list, from, to) {
  return list.filter((n) => {
    const t = lastOccurrence(n, to);
    return t !== null && t > from;
  });
}

/** One-off notifications that are still in the future (repeating ones always stay pending). */
function stillPending(list, now) {
  return list.filter((n) => {
    const s = (n && n.schedule) || {};
    return s.at == null || new Date(s.at).getTime() > now;
  });
}

module.exports = { lastOccurrence, dueBetween, stillPending };
