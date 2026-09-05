const fs = require("fs");
const path = require("path");
const dir = require("path").join(__dirname, "stock-dashboard");
const tpl = fs.readFileSync(path.join(dir, "_template.html"), "utf8");
const db = fs.readFileSync(path.join(dir, "data.json"), "utf8");
// 关键：必须用函数形式替换。若直接传字符串，data.json 中出现 $& / $` / $' / $$ 等
// JSONP/美元金额序列时会被 replace 当作特殊替换模式解释，导致整页数据损坏。
const out = tpl.replace("__DATA__", () => db);
fs.writeFileSync(path.join(dir, "index.html"), out);
console.log("Wrote index.html (" + out.length + " bytes).");

// Extract <script> and syntax-check it with node --check
const m = out.match(/<script>([\s\S]*?)<\/script>/);
if (m) {
  fs.writeFileSync(path.join(dir, "_check.js"), m[1]);
  console.log("Extracted script for syntax check.");
}
