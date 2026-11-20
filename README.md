# Planner-app

A simple, private planner that lives on your phone.

- **Your data stays on your phone.** No account, no server, no tracking. Tasks are saved in the phone's browser storage and never sent anywhere.
- **Works offline.** Once it's installed you don't need internet.
- **Installs like a normal app.** It gets its own icon on your home screen and opens full-screen.

## Features

- Week view: swipe left or right to change weeks, and tap a day to see its tasks
- Tasks with an optional time, a priority (low, medium or high) and notes
- Tick tasks off, with a progress bar for each day
- "Move to today" for unfinished tasks from earlier days
- Undo after deleting a task
- Backup and restore to a file (in the ••• menu)
- Light and dark mode follow your phone's setting

## Put it on your phone

The app has to be hosted once at a web address so your phone can download it. GitHub Pages does this for free:

1. On GitHub, open this repo and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the branch, choose `/ (root)`, and press **Save**.
3. After about a minute the page shows your app's address, something like `https://<your-username>.github.io/Planner-app/`.

Then open that address on your phone:

- **iPhone (Safari):** tap the **Share** button, then **Add to Home Screen**.
- **Android (Chrome):** tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

From then on, open it from the home-screen icon. It works without internet.

> **Tip:** Your tasks are only stored on your phone. If you delete the app or clear your browser data, they're gone. Use **••• → Save a backup file** now and then.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The app's screen |
| `styles.css` | How it looks |
| `app.js` | How it works, and saving to the phone |
| `sw.js` | Makes it work offline |
| `manifest.webmanifest`, `icons/` | App name and home-screen icon |

There's no build step. These are plain files.
