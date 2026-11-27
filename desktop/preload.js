// Gives the web app (www/app.js) a Capacitor-style LocalNotifications API on Windows.
// Only these few calls cross into the main process; the page gets nothing else from Node/Electron.
const { contextBridge, ipcRenderer } = require("electron");

const granted = () => Promise.resolve({ display: "granted" });
const noop = () => Promise.resolve();

contextBridge.exposeInMainWorld("plannerDesktop", {
  platform: "windows",
  // Daily automatic backup into Documents\Planner\Auto backups (the main process checks the file name)
  backup: {
    writeAuto: (name, json, keep) => ipcRenderer.invoke("backup:auto", { name, json, keep }),
  },
  notifications: {
    checkPermissions: granted,
    requestPermissions: granted,
    createChannel: noop,
    registerActionTypes: noop,
    schedule: (opts) => ipcRenderer.invoke("notif:schedule", opts),
    getPending: () => ipcRenderer.invoke("notif:pending"),
    cancel: (opts) => ipcRenderer.invoke("notif:cancel", opts),
    addListener: (event, cb) => {
      if (event !== "localNotificationActionPerformed" || typeof cb !== "function") {
        return Promise.resolve({ remove: noop });
      }
      const handler = (_e, action) => cb(action);
      ipcRenderer.on("notif:action", handler);
      return Promise.resolve({ remove: () => { ipcRenderer.removeListener("notif:action", handler); return noop(); } });
    },
  },
});
