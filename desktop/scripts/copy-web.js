// Copies the shared web app (../www) into desktop/www so Electron can package it.
// desktop/www is a build copy (git-ignored); always edit the real files in ../www.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "www");
const dest = path.join(__dirname, "..", "www");

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, {
  recursive: true,
  // the service worker is only for the browser version (the app never registers it from file://)
  filter: (p) => path.basename(p) !== "sw.js",
});
console.log("Copied www/ into desktop/www");
