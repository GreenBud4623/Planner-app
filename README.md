# Planner-app

A simple, private planner for Android.

- **Your data stays on your phone.** No account, no server, no tracking. Tasks are saved inside the app and never sent anywhere.
- **Works offline.** It doesn't need internet at all.
- **Made for Android:** reminders, back button, vibration on tick-off, themed icon, and light or dark mode to match your phone.

## Features

- Week view: swipe left or right to change weeks, and tap a day to see its tasks
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

## Building the APK yourself

You need Node.js 22+, JDK 21 and the Android SDK (platform 36).

```sh
npm install
npm run sync                     # copies www/ into the Android project
cd android && gradle assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`. To sign it, create `android/keystore.properties` (it's git-ignored) with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. Android only installs an update over an existing copy if both are signed with the **same key**.

## Project layout

| Path | What it is |
| --- | --- |
| `www/` | The app itself (HTML, CSS, JS). Also works as an installable web app in a browser. |
| `www/app.js` | All app logic, including the Android-only parts (reminders, back button, backups) |
| `android/` | The native Android project (made with [Capacitor](https://capacitorjs.com)) |
| `capacitor.config.json` | App ID, name and plugin settings |
