// 多源 7x24 财经快讯聚合：新浪 + 财联社 + 东财 → 分类打标 → 生成 news 快照
const https = require("https");
const fs = require("fs");
const path = require("path");
const DIR = require("path").join(__dirname, "stock-dashboard");
const DATA = path.join(DIR, "data.json");
const NEWS = path.join(DIR, "news.json");

function get(url, headers = {}) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 15000, headers: Object.assign({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json, text/javascript, */*" }, headers) }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, data: d }));
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", e => rej(e));
  });
}

function extractJsonpBody(cb, text) {
  // 支持 try{cb({...})}catch(e){} 或 cb({...}); 或纯 JSON
  const clean = text.trim().replace(/^try\s*\{\s*/, "").replace(/\s*\}\s*catch\s*\([^)]*\)\s*\{\s*\}\s*$/, "");
  const prefix = cb + "(";
  let idx = clean.indexOf(prefix);
  if (idx === -1 && clean.startsWith("{")) {
    // 纯 JSON 回退
    try { return JSON.parse(clean); } catch (e) { throw new Error("not jsonp: " + text.slice(0, 100)); }
  }
  if (idx === -1) throw new Error("not jsonp: " + text.slice(0, 100));
  let start = idx + prefix.length, depth = 0, end = -1, inString = false, escape = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error("jsonp body not closed");
  return JSON.parse(clean.slice(start, end));
}
function getJsonp(url, headers = {}) {
  return new Promise((res, rej) => {
    const cb = "wbjsonp" + Date.now() + Math.random().toString(36).slice(2, 8);
    const u = url + (url.includes("?") ? "&" : "?") + "callback=" + cb + "&_=" + Date.now();
    const req = https.get(u, { timeout: 15000, headers: Object.assign({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json, text/javascript, */*" }, headers) }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => {
        try { res(extractJsonpBody(cb, d)); } catch (e) { rej(e); }
      });
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", e => rej(e));
  });
}

// 与页面 classifyNews 一致的自动分类
function classifyNews(s) {
  let level = 'L2', dir = '中性', assets = ['全市场'], type = 'other';
  if (/网传|据悉|传闻|据传|知情人士|市场传闻/.test(s)) level = 'L3';
  else if (/美联储|FOMC|利率决议|MLF|LPR|央行|非农|CPI|PCE|GDP|关税|出口管制|制裁/.test(s)) { level = 'L1'; type = 'macro'; }
  else if (/国务院|证监会|财政部|印花税|分红制度|监管|国资委/.test(s)) { level = 'L1'; type = 'policy'; }
  else if (/财报|业绩|营收|净利润|盈利|预增|预亏/.test(s)) { level = 'L2'; type = 'earn'; }
  const a = [];
  if (/黄金|金价|金条|SPDR|央行购金|白银/.test(s)) a.push('黄金');
  if (/芯片|半导体|英伟达|台积电|存储|CPO|光模块|出口管制|晶圆/.test(s)) a.push('QDII', '芯片');
  if (/纳斯达克|纳指|美股|道指|标普|费半/.test(s)) a.push('美股', '纳指');
  if (/港股|恒生|恒指|中概/.test(s)) a.push('港股');
  if (/A股|上证|深成|沪深|证监会|印花税|北向|两融/.test(s)) a.push('大A');
  if (/分红|股息|红利|高股息/.test(s)) a.push('A红利');
  if (a.length) assets = a;
  if (/降息|宽松|放水|净买入|回购|新高|上调|增长|利好|超预期(?!利空)/.test(s)) dir = '利多';
  if (/加息|收紧|下滑|大跌|暴跌|处罚|减持|下调|利空|退市|爆雷/.test(s)) dir = '利空';
  if (/崩盘|危机|战争|大幅下挫|熔断/.test(s)) dir = '强利空';
  return { level, dir, assets, type };
}
const DAYS = { macro: 7, policy: 7, earn: 15, other: 7 };

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[\s，。！？、：；“”‘’（）【】\[\]()!?.,:;'`"·—\-—]+/g, '').slice(0, 36);
}
function parseTime(ct) {
  if (!ct) return null;
  const s = String(ct).trim();
  const dt = new Date(s.replace(/-/g, '/'));
  if (!isNaN(dt)) return dt;
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s));
  return null;
}

async function fetchSina() {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const u = `https://zhibo.sina.com.cn/api/zhibo/feed?page=${page}&page_size=40&zhibo_id=152&tag_id=0&dire=f&dpc=1`;
      const j = await getJsonp(u, { "Referer": "https://finance.sina.com.cn" });
      const list = (j.result && j.result.data && j.result.data.feed && j.result.data.feed.list) || [];
      list.forEach(it => {
        const title = (it.rich_text || "").replace(/\s+/g, " ").trim();
        if (!title) return;
        out.push({
          id: "feed-" + it.id,
          time: (it.create_time || "").slice(0, 16),
          title: title.slice(0, 140),
          ts: parseTime(it.create_time),
          source: "新浪7x24"
        });
      });
      if (list.length < 40) break;
    } catch (e) { console.log("sina page", page, "err", e.message); }
  }
  return out;
}

function fmtLocal(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
async function fetchCls() {
  const out = [];
  try {
    const u = "https://www.cls.cn/api/cache?app=CailianpressWeb&name=telegraph&os=web&sv=8.7.9";
    const r = await get(u, { "Referer": "https://www.cls.cn/telegraph", "X-Requested-With": "XMLHttpRequest" });
    const j = JSON.parse(r.data);
    const arr = (j.data && j.data.roll_data) || (Array.isArray(j.data) ? j.data : []);
    arr.forEach(it => {
      const title = (it.content || "").replace(/\s+/g, " ").trim();
      if (!title) return;
      const raw = it.ctime ? (String(it.ctime).length === 10 ? it.ctime * 1000 : it.ctime) : it.time;
      const ts = parseTime(raw);
      out.push({
        id: "cls-" + (it.id || it.ctime || Math.random().toString(36).slice(2)),
        time: ts ? fmtLocal(ts) : (it.time || "").slice(0, 16),
        title: title.slice(0, 140),
        ts,
        source: "财联社"
      });
    });
  } catch (e) { console.log("cls err", e.message); }
  return out;
}

async function fetchEastmoney() {
  const out = [];
  try {
    const ts = Date.now();
    const cb = "jQuery18305649304377500413_" + (ts - 40000);
    const u = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=40&req_trace=${ts}&_=${ts + 1}`;
    const r = await get(u + "&callback=" + cb, { "Referer": "https://finance.eastmoney.com/" });
    const m = r.data.match(/jQuery\d+_\d+\(([\s\S]*)\)\s*;?\s*$/);
    if (!m) throw new Error("jsonp mismatch");
    const j = JSON.parse(m[1]);
    const list = (j.data && j.data.fastNewsList) || [];
    list.forEach(it => {
      const title = (it.title || "").replace(/\s+/g, " ").trim();
      if (!title) return;
      out.push({
        id: "em-" + it.code,
        time: (it.showTime || "").slice(0, 16),
        title: title.slice(0, 140),
        ts: parseTime(it.showTime),
        source: "东财快讯"
      });
    });
  } catch (e) { console.log("em err", e.message); }
  return out;
}

(async () => {
  const [sina, cls, em] = await Promise.all([fetchSina(), fetchCls(), fetchEastmoney()]);
  console.log("sources raw:", { sina: sina.length, cls: cls.length, em: em.length });

  // 保留最近 48 小时
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const all = [...sina, ...cls, ...em]
    .filter(it => it.title && it.ts && it.ts.getTime() > cutoff)
    .sort((a, b) => b.ts - a.ts);

  // 按标题归一化去重（财联社/新浪/东财经常同一条快讯文字略有不同，优先保留最早/最短标题）
  const seen = new Set();
  const uniq = [];
  for (const it of all) {
    const k = normTitle(it.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const cls = classifyNews(it.title);
    uniq.push({
      id: it.id,
      time: it.time,
      title: it.title,
      level: cls.level, dir: cls.dir, assets: cls.assets, type: cls.type,
      days: DAYS[cls.type] || 7, source: it.source, auto: true,
    });
  }
  const top = uniq.slice(0, 60);
  console.log("merged items:", all.length, "→ uniq:", uniq.length, "→ top:", top.length);
  console.log("L1:", top.filter(x => x.level === "L1").length, " L2:", top.filter(x => x.level === "L2").length, " L3:", top.filter(x => x.level === "L3").length);

  // 写回 data.json（兼容旧字段 news + newsUpdated）
  const db = JSON.parse(fs.readFileSync(DATA, "utf8"));
  db.news = top;
  db.newsUpdated = new Date().toISOString();
  fs.writeFileSync(DATA, JSON.stringify(db));

  // 同时写独立 news.json，供浏览器客户端增量刷新（体积小）
  fs.writeFileSync(NEWS, JSON.stringify({ updated: db.newsUpdated, items: top }));

  console.log("WROTE news → data.json + news.json", top.length, "items");
  top.slice(0, 10).forEach(n => console.log(`  [${n.time}] [${n.source}] [${n.level}/${n.dir}] ${n.title.slice(0, 45)}`));
})();
