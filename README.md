# Planner-app

A simple, private planner for Android and Windows PC, made for school.

- **Your data stays on your device.** No account, no server, no tracking. Tasks are saved inside the app and never sent anywhere.
- **Works offline.** It doesn't need internet at all.
- **Runs on Android and Windows.** On Android: reminders, back button, vibration on tick-off, themed icon, and light or dark mode to match your phone.

## Features

The app has four tabs:

**Planner** shows your day: that day's classes, then your tasks. Swipe the week strip to change weeks. The **+ Homework** button on a class adds homework due at that class's next lesson. Tap a class to add homework, mark it as **missed** (it goes to *To recover*), or edit it.

**Timetable** holds your weekly classes. For each class you set the day(s), times, room or teacher, and a colour. Classes can overlap (for example optional subjects or split groups). They're shown together in an "At the same time" box. Tick **Weekly homework** and after every lesson:
- you get a notification asking *"Homework for Maths?"*. You can type the homework right in the notification, or tap **No homework** or **I was absent**.
- if you didn't answer, a popup asks **"What homework did you get?"** for each class the next time you open the app. Tap **Later** and it asks again the next time you open it.
- if you already marked the lesson as missed, or added its homework from the class, it doesn't ask.

**Holidays & days off** (top of the Timetable tab): add school holidays or sick days, with quick buttons for *Just today*, *Today + tomorrow* and *Rest of the week*. On those days classes are hidden, there are no after-class notifications or homework questions, and suggested due dates skip to the first lesson after the break. Upcoming check-in notifications are planned 6 weeks ahead and refreshed whenever you open the app.

**Homework** lists:
- **Past due**: anything not done whose date has passed, in red, with a badge on the tab
- **To recover**: classes you missed and need to catch up on (notes, a make-up test…), with the date you missed and an optional "recover by" date
- **Homework**: what's due next, by class
- **Long-term**: projects and other things that take a while, with an optional deadline

**Tests** lists your upcoming tests: the next 7 days first, then later ones, with a countdown ("Tomorrow", "In 3 days"). For each test you add the class, date, optional time, topic and what to study. You get a reminder the day before (or 2 days or a week before, or that morning). Tick a test when you've studied and it shows **Ready ✓**. After the test it moves to **Past tests**, where you can write down your grade. Tests also show on their day in the Planner, and the tab shows a badge when a test is today or tomorrow. You can also tap a class on the Planner and choose **Add a test**.

**Grades** (in the Tests tab): add grades per class (test, oral, homework or other). A grade you write on a past test counts automatically. Each class shows its average, and the **overall average** is the average of the class averages. Tap a class to see, edit or delete its grades. Grades can be written as `9`, `9.5` or `9,50`.

Also:
- Tasks with an optional time, a priority (low, medium or high) and notes
- **Reminders** at the task's time, or 10 minutes, 30 minutes, 1 hour or 1 day before. Tap a reminder to open that day.
- Tick tasks off, with a progress bar for each day
- "Move to today" for unfinished tasks from earlier days
- Undo after deleting a task
- **Week A / Week B:** a class can happen every week or only every other week. The Timetable shows which week it is, with a **Swap A/B** button.
- **Repeating tasks:** every day, every weekday, every week or every month. Ticking one off creates the next one.
- **Checklists:** add steps to any task, homework or project and see the progress (e.g. ☑ 2/5).
- **Home-screen widget (Android):** long-press the home screen → Widgets → Planner. Shows today's classes, what's due and tomorrow's tests and homework.
- **Sync phone ↔ PC over Wi-Fi:** on the PC, ••• → *Sync with phone* shows an address and a code; on the phone, ••• → *Sync with PC* and type them in. Both get everything, and the newest change of each item wins. Nothing goes through the internet; the data is encrypted with the one-time code. Both must be on the same Wi-Fi (allow Planner through the Windows firewall on private networks).
- **Evening heads-up** (Android and Windows apps): at 7 PM a notification lists what's due tomorrow: homework, tests and classes to recover. Change the time or switch it off in the ••• menu.
- **Automatic daily backup** (Android and Windows apps, on by default): once a day a copy is saved to **Documents › Planner › Auto backups**, keeping the last 7. Files there survive uninstalling the app. You can switch it off in the ••• menu.
- Backups by hand (in the ••• menu): save a file to **Documents › Planner**, or send one to Drive or email.
- **Restore** from any backup file and choose **Merge** (adds what's missing and keeps the newest version of everything; things you deleted stay deleted) or **Replace everything** (makes the device exactly like the backup). Both can be undone right after.

## Install on Android

1. Download `Planner.apk` to your phone.
2. Tap it. If Android asks, allow your browser or file app to **install unknown apps**.
3. Tap **Install**. If Play Protect warns about an unknown app, choose **Install anyway**. It only warns because the app isn't from the Play Store.
4. Open **Planner**. The first time you set a reminder, allow notifications.

> **Tip:** Because nothing leaves your phone, uninstalling the app deletes your tasks. Use **••• → Save a backup file** now and then.

## Install on Windows PC

1. Open the newest release on the **Releases** page and download `Planner-Setup.exe`.
2. Run it. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. It only warns because the app isn't signed by a paid certificate.
3. Planner installs for your user only (no admin needed) and adds a Start menu and desktop shortcut.

Don't want to install? Download `Planner-Portable.exe` instead and just run it.

**On the PC:**
- Reminders and the after-class *"Homework for Maths?"* check-ins show as Windows notifications. Click one to open that day or answer the check-in.
- Closing the window keeps Planner running in the **system tray** (by the clock) so reminders still arrive. Right-click the tray icon to **Quit**, or tick **Start with Windows** so reminders work after a restart.
- Keyboard shortcuts: **N** new item, **T** today, **← / →** previous / next day, **Ctrl + ← / →** previous / next week, **1–4** switch tabs, **Esc** closes a sheet.
- Backups save to **Documents › Planner** by default.
- Your phone and PC each keep their own tasks. To move tasks across, use **••• → Save a backup file** on one and **Restore from a backup file** on the other (restoring adds what's missing; it doesn't delete anything).

## Automatic builds (updates)

Every push to this repo builds a signed `Planner.apk` and the Windows `Planner-Setup.exe` / `Planner-Portable.exe` with GitHub Actions and posts them on the **Releases** page. Open the newest release, download the file for your device, and open it. It installs over the old version and keeps your tasks.

The Windows app builds without any setup. The APK needs the app's signing key saved as a repository secret, once. Until then, releases only contain the Windows files, and the release notes say so:

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

## Building the Windows app yourself

You need Node.js 22+ on Windows.

```sh
cd desktop
npm install
npm start        # run it
npm run build    # makes desktop/dist/Planner-Setup.exe and Planner-Portable.exe
```

`npm start` and `npm run build` first copy `www/` into `desktop/www` (a git-ignored build copy), so always edit the files in `www/`.

## Tests

`npm test` runs the automated tests in `tests/`: the app in a phone-sized browser with a stand-in for Android, with the clock fixed so results don't depend on the day. GitHub runs them on every push (`.github/workflows/test.yml`). The first time, run `npm ci` and `npx playwright install chromium`.

## Project layout

| Path | What it is |
| --- | --- |
| `www/` | The app itself (HTML, CSS, JS). Also works as an installable web app in a browser. |
| `www/app.js` | All app logic: planner, timetable, homework check-ins, plus the Android and Windows parts (notifications, back button, backups, keyboard shortcuts) |
| `android/` | The native Android project (made with [Capacitor](https://capacitorjs.com)) |
| `desktop/` | The Windows app (made with [Electron](https://www.electronjs.org)): window, tray, Windows notifications |
| `capacitor.config.json` | App ID, name and plugin settings |
| `.github/workflows/build.yml` | Builds the signed APK and the Windows app and publishes them on Releases |
