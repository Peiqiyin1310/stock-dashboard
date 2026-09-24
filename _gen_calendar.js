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

// 结果性词汇：命中才算「已出结果」
// （移除原来过宽的 `报`——它会命中"报道/报告"，把无关稿件也算成结果）
const RESULT_WORDS = /维持|不变|加息|降息|上调|下调|公布|出炉|升至|降至|超预期|不及预期|增长|下滑|通过|报收|报价/;
/* 预测/观点词：命中则**不视为结果**。
   2026-09-24 核查发现日历把预测当结果，例如杰克逊霍尔年会那条的结果是
   「【三菱日联预计美联储本月加息25基点】」——这是券商的预测，不是会议结果。
   项目早前就把「结果文本不得含 预计/预期/或将/研报 等预测词」写进了规范，但代码从未实现。 */
const FORECAST_WORDS = /预计|预期|或将|有望|可能|概率|料将|分析师|研报|研究|展望|认为|观点|市场定价|调查显示|倾向于|预计将|机构|券商/;

/* 统一按北京时间取日期。
   此前用本地 getter（getFullYear/getMonth/getDate），而 GitHub Actions runner 的本地时区是 UTC：
   实测 2026-09-23T23:28Z 那一轮产物里 calendar.today = "2026-09-23"，而北京已是 09-24。
   即每天北京 00:00~08:00 期间 today 都会落后一天，导致事件「是否已到日期」判断偏移。
   与 _gen.js / _gen_review.js 的既定口径保持一致：+8h 后用 getUTC* 读。 */
const bjShift = (d) => new Date(d.getTime() + 8 * 3600 * 1000);
function todayStr() {
  const t = bjShift(new Date());
  return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0") + "-" + String(t.getUTCDate()).padStart(2, "0");
}

// ===== 分红日历（2026-09-24 起：日历的「未来事件」改由真实分红排期驱动）=====
/* 为什么改：
   ① 上面 EVENTS 是 2026-08-20~09-21 的 10 条**硬编码**宏观事件——写死即过期。
      2026-09-21 之后日历再无任何未来事件，面板的「即将公布」等于永久空白。
   ② 结果回填会把券商预测当结果存档。线上实测 9/10 条含预测词，例如
      「专家：…9月LPR报价保持不变，后期有望下调」、「三菱日联预计美联储本月加息25基点」、
      「中信证券：2026年有望成为液冷产业链…」——全是观点，不是结果。FORECAST_WORDS
      只拦得住**新**匹配，拦不住 prevById 里的**已存档**旧值。

   新口径：日历未来事件 = 未来 N 天**已定档实施**的 A 股除权除息，取自东财 datacenter
   `RPT_SHAREBONUS_DET`。这是真实排期而非预测：仍处「预案/股东大会通过」阶段的记录
   没有登记日与除权日，天然被排除在窗口之外。

   字段量纲已标定：PRETAX_BONUS_RMB = 税前**每 10 股**派息（元）。校验案例：
   中国神华 601088 报告期 2024-12-31 = 22.6（公告每 10 股派 22.6 元）；
   长江电力 600900 报告期 2023-12-31 = 8.2（公告每 10 股派 8.2 元）。 */
const DIV_WINDOW_DAYS = 45;   // 前瞻窗口；前端月历只画到「今天+29 天」，留余量给清单
const DIV_MAX_ROWS = 24;      // 清单上限（候选池命中不受此限，永远展示）
const DIV_PER_DAY = 3;        // 单日市场名额上限——除权日高度聚集，不设上限会被「今天」一天占满
const DIV_MIN_AMT = 1;        // 市场名额门槛：每 10 股派息 ≥ 1 元，避免小额分红刷屏
/* 红利候选池：与 dividend-rotation 项目（其 data.json 的 all_rank 24 只）保持同步。
   命中会标 ★ 并**不受 DIV_MAX_ROWS 限制**永远展示。月度调仓后需同步本表。 */
const DIV_POOL = {
  "000651": "格力电器", "601166": "兴业银行", "600011": "华能国际", "600690": "海尔智家",
  "000538": "云南白药", "000333": "美的集团", "601318": "中国平安", "600036": "招商银行",
  "601398": "工商银行", "601288": "农业银行", "600900": "长江电力", "601857": "中国石油",
  "601328": "交通银行", "601088": "中国神华", "601658": "邮储银行", "600028": "中国石化",
  "601225": "陕西煤业", "000963": "华东医药", "601939": "建设银行", "601988": "中国银行",
  "601628": "中国人寿", "600436": "片仔癀", "600188": "兖矿能源", "600276": "恒瑞医药",
};
// 主板口径：000/001/002/003（深主板）+ 600/601/603/605（沪主板）；
// 排除 300/301 创业板、688/689 科创板、8xx/4xx/920 北交所
const isMainBoard = (c) => /^(000|001|002|003|600|601|603|605)/.test(c);
const fmtMD = (s) => (s ? s.slice(5) : "");
function addDaysStr(base, n) {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function fetchDividendRows(from) {
  const filter = encodeURIComponent("(EX_DIVIDEND_DATE>='" + from + "')");
  const url = "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET"
    + "&columns=SECURITY_CODE,SECURITY_NAME_ABBR,PRETAX_BONUS_RMB,EQUITY_RECORD_DATE,EX_DIVIDEND_DATE,ASSIGN_PROGRESS"
    + "&pageSize=300&pageNumber=1&sortColumns=EX_DIVIDEND_DATE&sortTypes=1&filter=" + filter + "&_=" + Date.now();
  const r = await get(url, { Referer: "https://data.eastmoney.com/" });
  const j = JSON.parse(r.data);
  if (!j || !j.success) throw new Error("eastmoney success=false");
  return (j.result && j.result.data) || [];
}

function buildDividendEvents(rows, today) {
  const end = addDaysStr(today, DIV_WINDOW_DAYS);
  /* 实测（2026-09-24）：未来 45 天只有 7 个除权日（9/24、9/28、9/29、9/30、10/8、10/9、10/12），
     但单日可堆 15~16 只——A 股中期分红集中在国庆前除权。若只按日期排序取前 N 条，
     这些名额会被「今天」一天吃光。故按「每日名额」分摊，保证清单覆盖每个除权日。
     清单是**精选**（每日最多 DIV_PER_DAY 只主板个股 + 全部候选池命中），不是全量除权名单；
     面板标题本就是「重点事件清单」，不宣称完整。 */
  const eligible = [];
  for (const row of rows) {
    if (row.ASSIGN_PROGRESS !== "实施分配") continue;      // 只认已定档实施，排除预案/预测阶段
    const code = String(row.SECURITY_CODE || "");
    const rec = String(row.EQUITY_RECORD_DATE || "").slice(0, 10);
    const ex = String(row.EX_DIVIDEND_DATE || "").slice(0, 10);
    if (!ex || ex < today || ex > end) continue;           // 只留窗口内的未来除权
    const inPool = Object.prototype.hasOwnProperty.call(DIV_POOL, code);
    const amt = typeof row.PRETAX_BONUS_RMB === "number" ? row.PRETAX_BONUS_RMB : null;
    if (!inPool) {
      if (!isMainBoard(code)) continue;
      if (amt == null || amt < DIV_MIN_AMT) continue;
    }
    /* 事件日期用**股权登记日**（登记日收盘持有即可分红 = 最后买入日，决策意义最强）；
       登记日已过（今天正是除权日）时退回除权除息日，保证事件永远落在未来日期上，
       不会出现「结果待更新」的假状态。文案随口径切换——登记日已过就不要再写「买入可分红」。 */
    const useRecord = !!rec && rec >= today;
    const amtTxt = amt != null ? "每 10 股派 " + amt + " 元（税前）" : "派息金额待实施公告";
    eligible.push({
      id: "div-" + code + "-" + ex,
      date: useRecord ? rec : ex,
      ex,
      tag: "分红",
      key: true,                 // 必须 true：非 key 会被前端当作「自定义事件」渲染出删除按钮
      est: false,                // 实施分配=已定档，非预估，不打「约」标
      pool: inPool,
      amt: amt == null ? 0 : amt,
      name: (inPool ? "★" : "") + (row.SECURITY_NAME_ABBR || DIV_POOL[code] || code) + (useRecord ? " 股权登记日" : " 除权除息日"),
      preview: useRecord
        ? "股权登记日 " + fmtMD(rec) + "（登记日收盘持有即可参与分红）｜除权除息 " + fmtMD(ex) + "｜" + amtTxt
        : "除权除息日 " + fmtMD(ex) + "（股权登记日 " + fmtMD(rec) + " 已过，今日起按除权价交易）｜" + amtTxt,
    });
    if (inPool) eligible[eligible.length - 1].preview += "。★ 红利候选池";
  }
  // 同日按派息额从大到小，名额优先给更有分量的分红
  eligible.sort((a, b) => a.date.localeCompare(b.date) || b.amt - a.amt || a.id.localeCompare(b.id));
  const perDay = {};
  const picked = [];
  for (const e of eligible) {
    const used = perDay[e.ex] || 0;
    if (!e.pool) {
      if (used >= DIV_PER_DAY) continue;
      if (picked.length >= DIV_MAX_ROWS) continue;
    }
    perDay[e.ex] = used + 1;
    picked.push(e);
  }
  return picked.sort((a, b) => a.date.localeCompare(b.date) || a.ex.localeCompare(b.ex) || (b.pool ? 1 : -1));
}

/* ===== 周期性宏观锚点（2026-09-24 新增）=====
   原 EVENTS 里的宏观事件是**一次性硬编码**，过期即永久消失（这正是日历变空的主因）。
   这里改为按**公布惯例**滚动推算未来日期，标 est=true 让前端打「约」标，绝不冒充确定日期：
     · 中国 LPR 报价：每月 20 日 09:15，遇周末顺延至下一工作日
     · 中国官方制造业 PMI：每月最后一个工作日 09:30
     · 美国非农 NFP：每月第一个周五 20:30（北京时间，夏令时）
   FOMC / CPI 等日期不规律，宁可不放，也不编。规则推导保证日历**永不为空**，
   即使东财分红接口整轮挂掉，面板仍有 3 条真实存在的日程可看。 */
function buildRecurringMacro(today, days) {
  const out = [];
  const end = addDaysStr(today, days);
  const push = (date, tag, name, preview, match, need) => {
    if (date < today || date > end) return;
    out.push({ id: "mk-" + date + "-" + tag + "-" + out.length, date, tag, name, preview, key: true, est: true, _match: match, _need: need });
  };
  for (let i = 0; i <= days; i++) {
    const ds = addDaysStr(today, i);
    const d = new Date(ds + "T00:00:00Z");
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const dom = d.getUTCDate(), dow = d.getUTCDay();                        // dow: 0=周日
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();               // 当月天数
    // 月末最后一个工作日
    let lastBiz = dim;
    { const lw = new Date(Date.UTC(y, m, lastBiz)).getUTCDay();
      if (lw === 0) lastBiz -= 2; else if (lw === 6) lastBiz -= 1; }
    const biz = dow !== 0 && dow !== 6;
    if (biz && dom === 20) push(ds, "利率", "中国 LPR 报价", "每月 20 日 09:15 公布 1 年期与 5 年期以上 LPR 报价。", [/LPR|贷款市场报价利率/], null);
    if (dow === 1 && (dom === 21 || dom === 22)) push(ds, "利率", "中国 LPR 报价", "20 日逢周末，按惯例顺延至本日公布。", [/LPR|贷款市场报价利率/], null);
    if (biz && dom === lastBiz) push(ds, "数据", "中国官方 PMI", "月末最后一个工作日 09:30 公布制造业与非制造业 PMI。", [/PMI|采购经理/], [/制造业|非制造业|指数/]);
    if (dow === 5 && dom <= 7) push(ds, "数据", "美国非农 NFP", "通常为每月第一个周五 20:30（北京时间）公布，遇假期可能顺延一周。", [/非农/], [/新增|失业率|就业|万人/]);
  }
  return out;
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
  // 同上：本地时区是 UTC 时会把“7小时前”的北京快讯标成前一天，统一改成北京时间
  const t = bjShift(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
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
    if (FORECAST_WORDS.test(t)) continue;          // 预测/研报/观点不算结果
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
  let prevEvents = [];
  let prevFilled = 0;
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    prevEvents = prev.events || [];
    prevEvents.forEach((e) => { if (e.result) { prevById[e.id] = e.result; prevFilled++; } });
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

  // —— 分红日历（未来事件主力）：真实排期，抓不到就沿用上一轮，绝不给空面板 ——
  let divEvents = [];
  let divStale = false;
  try {
    const rows = await fetchDividendRows(today);
    divEvents = buildDividendEvents(rows, today);
    console.log(`[calendar] 除权除息抓取成功：东财原始 ${rows.length} 条 → 窗口内采用 ${divEvents.length} 条（★候选池命中 ${divEvents.filter((e) => e.pool).length}）`);
  } catch (e) {
    divStale = true;
    /* 沿用上一轮时必须剔除**已过期**条目：否则「事件日期在过去」会被校验闸门拦下，
       导致整站（行情/快讯）跟着停更——这正是「严格闸门 × 沿用旧值」的致命组合。 */
    divEvents = prevEvents.filter((x) => String(x.id || "").indexOf("div-") === 0 && String(x.date || "") >= today);
    console.log(`[calendar] 除权除息抓取失败，沿用上一轮分红条目 ${divEvents.length} 条（已剔除过期）：${e.message}`);
  }

  /* —— 宏观事件 A：一次性事件表（只输出**未来**日期）——
     过去事件的归档不再进入面板。原因：它们的结果多来自券商观点而非官方结果
     （线上 9/10 条含预测词），且「日期已过 + 无结果」会长期显示为「结果待更新」。
     历史条目仍保留在 EVENTS 数组里、seed 不删，日后新增未来事件可直接复用同一套匹配逻辑。 */
  const macroEvents = EVENTS.filter((ev) => ev.date >= today).map((ev) => {
    const e = { id: ev.id, date: ev.date, tag: ev.tag, name: ev.name, preview: ev.preview, key: true };
    // 优先级：本次实时匹配 > 已持久化结果 > 人工核实种子（后两者命中预测词一律作废）
    const live = matchResult(ev, pool, today);
    const kept = FORECAST_WORDS.test(prevById[ev.id] || "") ? "" : (prevById[ev.id] || "");
    const seed = FORECAST_WORDS.test(ev.seed || "") ? "" : (ev.seed || "");
    e.result = live || kept || seed;
    e.resultAt = e.result ? new Date().toISOString() : "";
    e.src = live ? "实时快讯" : (kept ? "已存档" : (seed ? "已核实" : ""));
    return e;
  });

  /* —— 宏观事件 B：周期性锚点（按公布惯例滚动推算，est=true → 前端打「约」标）——
     结果同样由快讯回填，但受 FORECAST_WORDS 约束（不再把券商预测当结果）；
     id 含日期，每月变化，不会把上月结果留到下月显示。 */
  const macroRecurring = buildRecurringMacro(today, DIV_WINDOW_DAYS).map((ev) => {
    const live = matchResult({ date: ev.date, match: ev._match, need: ev._need }, pool, today);
    const kept = FORECAST_WORDS.test(prevById[ev.id] || "") ? "" : (prevById[ev.id] || "");
    const e = Object.assign({}, ev);
    delete e._match; delete e._need;
    e.result = live || kept || "";
    e.resultAt = e.result ? new Date().toISOString() : "";
    e.src = live ? "实时快讯" : (kept ? "已存档" : "");
    return e;
  });
  const allMacro = macroRecurring.concat(macroEvents);

  const events = divEvents.concat(allMacro)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const filled = events.filter((e) => e.result).length;
  const payload = {
    updated: new Date().toISOString(), today, filled, total: events.length, events,
    divCount: divEvents.length, divPool: divEvents.filter((e) => e.pool).length, divStale,
    macroCount: allMacro.length,
  };

  try {
    const db = JSON.parse(fs.readFileSync(DATA, "utf8"));
    db.calendar = payload;
    fs.writeFileSync(DATA, JSON.stringify(db));
  } catch (e) { console.log("[calendar] 写 data.json 失败:", e.message); }
  fs.writeFileSync(OUT, JSON.stringify(payload));

  // changed=1 表示条目/结果有变化，据此可判断是否需要重建部署；无变化则静默跳过，省资源
  const sig = (arr) => arr.map((e) => e.id + ":" + (e.result || "")).join("|");
  const changed = sig(events) === sig(prevEvents) ? 0 : 1;
  console.log(`[calendar] changed=${changed} · 分红 ${divEvents.length} 条（★候选池 ${payload.divPool}${divStale ? " ·沿用旧值" : ""}）· 宏观 ${allMacro.length} 条（周期锚点 ${macroRecurring.length}）· filled=${filled}/${events.length} · today=${today}`);
  divEvents.filter((e) => e.pool).forEach((e) => console.log(`   ★ ${e.date} ${e.name} ｜ ${e.preview}`));
  allMacro.forEach((e) => console.log(`   ${e.date} ${e.tag} ${e.name} → ${e.result ? "✅ [" + e.src + "] " + e.result.slice(0, 46) : "⏳ 待公布"}`));
})();
