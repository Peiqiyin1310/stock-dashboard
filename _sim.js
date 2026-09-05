const fs = require("fs");
const dir = require("path").join(__dirname, "stock-dashboard");
const check = fs.readFileSync(dir + "/_check.js", "utf8");
// Extract the pure analysis block (from `const last` up to the render section)
// 注意：标记必须与模板注释完全一致（曾写 "===== 渲染 =====" 失配 → indexOf=-1 → 切到文件尾 eval 到 DOM 代码报错）
const start = check.indexOf("const last = a =>");
const end = check.indexOf("/* ===== 渲染工具 ===== */");
if (start < 0 || end < 0 || end <= start) { console.log("SKIP: analysis block markers not found in _check.js"); process.exit(0); }
const block = check.slice(start, end);
// Evaluate the block to define the functions in this scope
eval(block);

const db = JSON.parse(fs.readFileSync(dir + "/data.json", "utf8"));
let problems = 0;
for (const key of Object.keys(db.symbols)) {
  const m = db.symbols[key];
  if (m.noData) { console.log(key.padEnd(11), m.name, "=> [noData placeholder]"); continue; }
  if (m.quoteOnly) { console.log(key.padEnd(11), m.name, "=> [quoteOnly 现货，无K线，跳过]"); continue; }
  try {
    const res = analyze(m);
    const vals = [res.price, res.ma[5], res.ma[10], res.ma[20], res.ma[60], res.rsi, res.k, res.j, res.pctB, res.volRatio, res.score, res.chgPct];
    const bad = vals.filter(v => typeof v === "number" && (isNaN(v) || !isFinite(v)));
    const flag = bad.length ? "  <<< NaN/Inf!" : "";
    if (bad.length) problems++;
    console.log(key.padEnd(11), m.name.padEnd(8), "sig=" + res.sig.padEnd(6),
      "price=" + res.price.toFixed(2).padStart(11),
      "chg=" + res.chgPct.toFixed(2).padStart(7) + "%",
      "RSI=" + res.rsi.toFixed(0), "J=" + res.j.toFixed(0),
      "volR=" + res.volRatio.toFixed(2),
      "score=" + res.score + flag);
  } catch (e) {
    problems++;
    console.log(key.padEnd(11), m.name, "=> EXCEPTION: " + e.message);
  }
}
console.log("\nProblems: " + problems);
