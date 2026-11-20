# Planner-app

A simple, private planner for Android, made for school.

- **Your data stays on your phone.** No account, no server, no tracking. Tasks are saved inside the app and never sent anywhere.
- **Works offline.** It doesn't need internet at all.
- **Made for Android:** reminders, back button, vibration on tick-off, themed icon, and light or dark mode to match your phone.

## Features

The app has three tabs:

**Planner** shows your day: that day's classes, then your tasks. Swipe the week strip to change weeks. The **+ Homework** button on a class adds homework due at that class's next lesson.

**Timetable** holds your weekly classes. For each class you set the day(s), times, room or teacher, and a colour. Tick **Weekly homework** and after every lesson:
- you get a notification asking *"Homework for Maths?"*. You can type the homework right in the notification, or tap **No homework**.
- if you didn't answer, a popup asks **"What homework did you get?"** for each class the next time you open the app. Tap **Later** and it asks again the next time you open it.

**Homework** lists:
- **Past due**: anything not done whose date has passed, in red, with a badge on the tab
- **Homework**: what's due next, by class
- **Long-term**: projects and other things that take a while, with an optional deadline

Also:
- Tasks with an optional time, a priority (low, medium or high) and notes
- **Reminders** at the task's time, or 10 minutes, 30 minutes, 1 hour or 1 day before. Tap a reminder to open that day.
- Tick tasks off, with a progress bar for each day
- "Move to today" for unfinished tasks from earlier days
- Undo after deleting a task
- Backups (in the ••• menu): save a file to **Documents › Planner**, or send one to Drive or email. Restore from a backup file.

## Install on Android

1. Download `Planner.apk` to your phone.
2. Tap it. If Android asks, allow your browser or file app to **install unknown apps**.
3. Tap **Install**. If Play Protect warns about an unknown app, choose **Install anyway**. It only warns because the app isn't from the Play Store.
4. Open **Planner**. The first time you set a reminder, allow notifications.

> **Tip:** Because nothing leaves your phone, uninstalling the app deletes your tasks. Use **••• → Save a backup file** now and then.

## Automatic builds (updates)

Every push to this repo builds a signed `Planner.apk` with GitHub Actions and posts it on the **Releases** page. Open the newest release on your phone, download `Planner.apk`, and tap it. It installs over the old version and keeps your tasks.

This needs the app's signing key saved as a repository secret, once:

1. Repo **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `SIGNING_KEY`
3. Value: paste the whole contents of `SIGNING_KEY.txt` (one long line of text)

Keep that text private and don't commit it. Anyone who has it can make APKs that Android accepts as updates to Planner. If you lose it, future versions can't install over the current one (back up, uninstall, reinstall, restore).

## Building the APK yourself

You need Node.js 22+, JDK 21 and the Android SDK (platform 36).

```sh
npm install
npm run sync                     # copies www/ into the Android project
cd android && gradle assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`. To sign it, unpack the key into `android/` (both files are git-ignored): `base64 -d SIGNING_KEY.txt | tar -xz -C android`. Android only installs an update over an existing copy if both are signed with the **same key**.

## Project layout

| Path | What it is |
| --- | --- |
| `www/` | The app itself (HTML, CSS, JS). Also works as an installable web app in a browser. |
| `www/app.js` | All app logic: planner, timetable, homework check-ins, plus the Android-only parts (notifications, back button, backups) |
| `android/` | The native Android project (made with [Capacitor](https://capacitorjs.com)) |
| `capacitor.config.json` | App ID, name and plugin settings |
| `.github/workflows/android.yml` | Builds the signed APK and publishes it on Releases |
