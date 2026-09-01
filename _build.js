const fs = require("fs");
const path = require("path");
const dir = require("path").join(__dirname, "stock-dashboard");
const tpl = fs.readFileSync(path.join(dir, "_template.html"), "utf8");
const db = fs.readFileSync(path.join(dir, "data.json"), "utf8");
const out = tpl.replace("__DATA__", db);
fs.writeFileSync(path.join(dir, "index.html"), out);
console.log("Wrote index.html (" + out.length + " bytes).");

// Extract <script> and syntax-check it with node --check
const m = out.match(/<script>([\s\S]*?)<\/script>/);
if (m) {
  fs.writeFileSync(path.join(dir, "_check.js"), m[1]);
  console.log("Extracted script for syntax check.");
}
