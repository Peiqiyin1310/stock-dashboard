// _gen_calendar.js —「财经日历」关键事件结果回填（实时）
// 1) 定义精简的关键事件（结论前置、一句话）
// 2) 抓多源快讯（新浪/财联社/东财）+ 读后台新闻快照，按关键词匹配「日期已到」事件的真实结果
// 3) 结果持久化：已回填的结果写进 calendar.json 后不再丢失（快讯会滚走，结果不会）
// 4) 产出 data.json.calendar（构建注入） + stock-dashboard/calendar.json（前端实时刷新）
// 用法：node _gen_calendar.js
const fs = require("fs");
const path = require("path");
const https = require("https");

const DIR = require("path").join(__dirname, "stock-dashboard");
const DATA = path.join(DIR, "data.json");
const NEWSJSON = path.join(DIR, "news.json");
const OUT = path.join(DIR, "calendar.json");

// ===== 关键事件（精简文案 + 结果匹配规则）=====
// seed = 已核实的历史结果（人工/联网确认后固化，永不被覆盖丢失）
const EVENTS = [
  { id: "k-cn-lpr-0820", date: "2026-08-20", tag: "利率", name: "中国 LPR 报价",
    preview: "每月20日 09:00 公布，看是否降息。",
    seed: "1年期 3.0%、5年期以上 3.5%，连续 15 个月未变。银行净息差低位，短期加码宽松紧迫性不强。",
    match: [/LPR|贷款市场报价利率/] },

  { id: "k-nvda-0826", date: "2026-08-26", tag: "财报", name: "英伟达 Q2 财报",
    preview: "8/26 美股盘后公布，AI 算力风向标。",
    seed: "营收 $962 亿（+106%）、净利 $597 亿（+126%），毛利率 75%，均超预期。数据中心 $890 亿（+117%）。Q3 指引 $1080 亿，盘后涨超 4%。",
    match: [/英伟达|NVDA/], need: [/财报|营收|业绩|净利|季报|Q2|盘后/] },

  { id: "k-bok-0827", date: "2026-08-27", tag: "利率", name: "韩国央行决议",
    preview: "市场关注是否连续第二次加息。",
    seed: "加息 25bp 至 3.00%，为连续第二次加息（6票赞成、1票反对）。2026 年 GDP 预期由 2.6% 大幅上调至 3.3%。",
    match: [/韩国央行|韩国.{0,6}利率|BoK/], need: [/加息|降息|维持|不变|利率/] },

  { id: "k-jh-0827", date: "2026-08-27", tag: "央行", name: "杰克逊霍尔央行年会",
    preview: "沃什 8/28 22:00 讲话（上任后首秀）。市场关注是否释放加息信号。",
    seed: "",
    match: [/杰克逊霍尔|央行年会/], need: [/沃什|加息|降息|讲话|通胀/] },

  { id: "k-us-nfp-0904", date: "2026-09-04", tag: "数据", name: "美国非农 NFP",
    preview: "就业强弱直接左右 9月 FOMC 加息与否。",
    seed: "",
    match: [/非农/], need: [/新增|失业率|就业|万人|公布|出炉/] },

  { id: "k-ecb-0910", date: "2026-09-10", tag: "利率", name: "欧洲央行决议",
    preview: "存款利率现 2.25%，看继续加息还是暂停。",
    seed: "",
    match: [/欧洲央行|ECB/], need: [/加息|降息|维持|不变|利率/] },

  { id: "k-fomc-0916", date: "2026-09-16", tag: "利率", name: "美联储 FOMC 决议",
    preview: "当前 3.50%–3.75%，含点阵图。市场定价加息概率约三至四成。",
    seed: "",
    match: [/FOMC|美联储/], need: [/加息|降息|维持|不变|利率决议|点阵图/] },

  { id: "k-boe-0917", date: "2026-09-17", tag: "利率", name: "英国央行决议",
    preview: "当前银行利率 3.75%。",
    seed: "",
    match: [/英国央行|英国.{0,4}利率|BoE/], need: [/加息|降息|维持|不变|利率/] },

  { id: "k-boj-0918", date: "2026-09-18", tag: "利率", name: "日本央行决议",
    preview: "当前 0.75%，看是否加息至 1.0%，牵动日元日股。",
    seed: "",
    match: [/日本央行|日银|BoJ/], need: [/加息|降息|维持|不变|利率/] },

  { id: "k-cn-lpr-0921", date: "2026-09-21", tag: "利率", name: "中国 LPR 报价",
    preview: "20日逢周末顺延至21日。已连续 15 个月未变。",
    seed: "",
    match: [/LPR|贷款市场报价利率/] },
];

// 结果性词汇：命中才算「已出结果」，避免把"预期升温"当成结果
const RESULT_WORDS = /维持|不变|加息|降息|上调|下调|公布|出炉|升至|降至|超预期|不及预期|报|增长|下滑|通过/;

function todayStr() {
  const t = new Date();
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}

// ---------- 抓取：复用 _gen_news.js 的多源逻辑 ----------
function get(url, headers = {}) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 15000, headers: Object.assign({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json, text/javascript, */*" }, headers) }, (r) => {
      let d = ""; r.on("data", (c) => d += c); r.on("end", () => res({ status: r.statusCode, data: d }));
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", rej);
  });
}
function extractJsonpBody(cb, text) {
  const clean = text.trim().replace(/^try\s*\{\s*/, "").replace(/\s*\}\s*catch\s*\([^)]*\)\s*\{\s*\}\s*$/, "");
  const prefix = cb + "(";
  let idx = clean.indexOf(prefix);
  if (idx === -1) {
    if (clean.startsWith("{")) { try { return JSON.parse(clean); } catch (e) { throw new Error("not jsonp"); } }
    throw new Error("not jsonp");
  }
  let start = idx + prefix.length, depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("jsonp not closed");
  return JSON.parse(clean.slice(start, end));
}
function getJsonp(url, headers = {}) {
  return new Promise((res, rej) => {
    const cb = "wbcal" + Date.now() + Math.random().toString(36).slice(2, 7);
    const u = url + (url.includes("?") ? "&" : "?") + "callback=" + cb + "&_=" + Date.now();
    const req = https.get(u, { timeout: 15000, headers: Object.assign({ "User-Agent": "Mozilla/5.0", "Accept": "*/*" }, headers) }, (r) => {
      let d = ""; r.on("data", (c) => d += c); r.on("end", () => { try { res(extractJsonpBody(cb, d)); } catch (e) { rej(e); } });
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", rej);
  });
}
function parseTime(ct) {
  if (!ct) return null;
  const s = String(ct).trim();
  const dt = new Date(s.replace(/-/g, "/"));
  if (!isNaN(dt)) return dt;
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s));
  return null;
}
function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fetchSina() {
  const out = [];
  for (let page = 1; page <= 4; page++) {
    try {
      const u = `https://zhibo.sina.com.cn/api/zhibo/feed?page=${page}&page_size=40&zhibo_id=152&tag_id=0&dire=f&dpc=1`;
      const j = await getJsonp(u, { Referer: "https://finance.sina.com.cn" });
      const list = (j.result && j.result.data && j.result.data.feed && j.result.data.feed.list) || [];
      list.forEach((it) => {
        const title = (it.rich_text || "").replace(/\s+/g, " ").trim();
        if (title) out.push({ time: (it.create_time || "").slice(0, 16), title: title.slice(0, 140), source: "新浪7x24" });
      });
      if (list.length < 40) break;
    } catch (e) { /* 单页失败忽略 */ }
  }
  return out;
}
async function fetchCls() {
  const out = [];
  try {
    const r = await get("https://www.cls.cn/api/cache?app=CailianpressWeb&name=telegraph&os=web&sv=8.7.9",
      { Referer: "https://www.cls.cn/telegraph", "X-Requested-With": "XMLHttpRequest" });
    const j = JSON.parse(r.data);
    const arr = (j.data && j.data.roll_data) || (Array.isArray(j.data) ? j.data : []);
    arr.forEach((it) => {
      const title = (it.content || "").replace(/\s+/g, " ").trim();
      if (!title) return;
      const ts = parseTime(it.ctime ? (String(it.ctime).length === 10 ? it.ctime * 1000 : it.ctime) : it.time);
      out.push({ time: ts ? fmtLocal(ts) : (it.time || "").slice(0, 16), title: title.slice(0, 140), source: "财联社" });
    });
  } catch (e) {}
  return out;
}
async function fetchEastmoney() {
  const out = [];
  try {
    const ts = Date.now();
    const cb = "jQuery18305649304377500413_" + (ts - 40000);
    const u = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=40&req_trace=${ts}&_=${ts + 1}`;
    const r = await get(u + "&callback=" + cb, { Referer: "https://finance.eastmoney.com/" });
    const m = r.data.match(/jQuery\d+_\d+\(([\s\S]*)\)\s*;?\s*$/);
    if (!m) throw new Error("mismatch");
    const list = (JSON.parse(m[1]).data && JSON.parse(m[1]).data.fastNewsList) || [];
    list.forEach((it) => {
      const title = (it.title || "").replace(/\s+/g, " ").trim();
      if (title) out.push({ time: (it.showTime || "").slice(0, 16), title: title.slice(0, 140), source: "东财快讯" });
    });
  } catch (e) {}
  return out;
}

// 本地快照兜底（注意：news.json 的字段是 items，不是 news）
function loadLocalNews() {
  const out = [];
  try {
    const j = JSON.parse(fs.readFileSync(NEWSJSON, "utf8"));
    (j.items || j.news || []).forEach((n) => out.push({ time: n.time || "", title: (n.title || "").trim(), source: n.source || "" }));
  } catch (e) {}
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    (d.news || []).forEach((n) => out.push({ time: n.time || "", title: (n.title || "").trim(), source: n.source || "" }));
  } catch (e) {}
  return out;
}

function matchResult(ev, pool, today) {
  if (ev.date > today) return null;
  const hits = [];
  for (const n of pool) {
    const t = n.title;
    if (!t) continue;
    if (!ev.match.some((re) => re.test(t))) continue;
    if (ev.need && ev.need.length && !ev.need.some((re) => re.test(t))) continue;
    if (!RESULT_WORDS.test(t)) continue;
    if (n.time && n.time.slice(0, 10) < ev.date) continue;
    hits.push(n);
    if (hits.length >= 2) break;
  }
  if (!hits.length) return null;
  return hits.map((h) => h.title.replace(/\s+/g, " ").slice(0, 68)).join(" ｜ ");
}

(async () => {
  const today = todayStr();

  // 已持久化的结果：优先保留（快讯会滚走，结果不能丢）
  const prevById = {};
  let prevFilled = 0;
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    (prev.events || []).forEach((e) => { if (e.result) { prevById[e.id] = e.result; prevFilled++; } });
  } catch (e) {}

  let pool = [];
  try {
    const [sina, cls, em] = await Promise.all([fetchSina(), fetchCls(), fetchEastmoney()]);
    pool = [...sina, ...cls, ...em];
    console.log(`[calendar] 实时抓取 新浪${sina.length} / 财联社${cls.length} / 东财${em.length}`);
  } catch (e) { console.log("[calendar] 抓取失败，回落本地快照"); }
  if (!pool.length) pool = loadLocalNews();
  else pool = pool.concat(loadLocalNews());

  const seen = new Set();
  pool = pool.filter((n) => { const k = n.title.slice(0, 30); if (!k || seen.has(k)) return false; seen.add(k); return true; });

  const events = EVENTS.map((ev) => {
    const e = { id: ev.id, date: ev.date, tag: ev.tag, name: ev.name, preview: ev.preview, key: true };
    // 优先级：本次实时匹配 > 已持久化结果 > 人工核实种子
    const live = matchResult(ev, pool, today);
    const kept = prevById[ev.id] || "";
    const seed = ev.seed || "";
    e.result = live || kept || seed;
    e.resultAt = e.result ? new Date().toISOString() : "";
    e.src = live ? "实时快讯" : (kept ? "已存档" : (seed ? "已核实" : ""));
    return e;
  });

  const filled = events.filter((e) => e.result).length;
  const payload = { updated: new Date().toISOString(), today, filled, total: events.length, events };

  try {
    const db = JSON.parse(fs.readFileSync(DATA, "utf8"));
    db.calendar = payload;
    fs.writeFileSync(DATA, JSON.stringify(db));
  } catch (e) { console.log("[calendar] 写 data.json 失败:", e.message); }
  fs.writeFileSync(OUT, JSON.stringify(payload));

  // changed=1 表示本次有新回填的结果，自动化据此决定是否重建部署；无变化则静默跳过，省资源
  const changed = filled > prevFilled ? 1 : 0;
  console.log(`[calendar] changed=${changed} filled=${filled}/${events.length} · 池 ${pool.length} 条 · today=${today}`);
  events.forEach((e) => console.log(`   ${e.date} ${e.name} → ${e.result ? "✅ [" + e.src + "] " + e.result.slice(0, 46) : "⏳ 待公布"}`));
})();
