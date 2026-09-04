// _gen_review.js — 生成「每日复盘」10模块数据，写入 data.json 的 review 字段
// 数据源：westock MCP 快照（由助手探取后固化于 SNAPSHOT）+ 新浪外汇/腾讯期货实时补抓 + data.json 已有行情
// 用法：node _gen_review.js   （每个交易日由助手更新 SNAPSHOT 后重跑）
const fs = require("fs");
const https = require("https");

const DATA = require("path").join(__dirname, "stock-dashboard", "data.json");
// 每个交易日盘后由 MCP 抓取的当日快照写入此文件；存在时优先使用，否则自动用东财公开接口抓取（云端模式）
const SNAP_FILE = require("path").join(__dirname, "review_snapshot.json");
let TRADE_DATE = "2026-08-21"; // 复盘对应的交易日（可被快照覆盖）

// =====  westock MCP 数据快照（2026-08-21 交易日，由助手通过 MCP 探取） =====
let SNAPSHOT = {
  // ② 市场交易数据
  breadth: { red: 2505, green: 2862, zero: 182, total: 5549, uplimit: 54, dnlimit: 1,
    updownRatio: 0.88, high10: 333, high60: 92, high250: 22, low10: 2173, low60: 46, low250: 37 },
  trade: { money: 18792.64, moneyRatio5d: 83.46, moneyRatio10d: 81.89, moneyRatio20d: 81.19,
    sh: { close: 3905.2, pct: 0.04 }, sz: { close: 14094.17, pct: 0.87 }, cyb: { close: 3545.58, pct: 1.43 } },
  // 市场画像
  profile: { sentiment: "情绪狂热(涨停>50只)", cap: "小盘主导(中证1000 > 沪深300 +8%)",
    sectorWidth: "局部热点(上涨板块40~60%)", stockWidth: "普涨(创新高>200只)",
    volume: "缩量震荡", valuation: "偏高区间(PE分位数70%~90%)",
    trendShort: "温和上涨(均线多头排列)", trendLong: "弱势下跌(均线空头排列)", technical: "中性" },
  // ⑤ 宏观
  valuation: { pe: 21.26, pePct10y: 88.53, pePct5y: 83.97, pePct3y: 73.28, pb: 1.77, div: 1.84, date: "2026-08-20" },
  macro: { cn10y: 1.6833, cn2y: 1.2393, termSpread: 44.4, curveFormD: "熊平", date: "2026-08-21" },
  // ③ 资金面：板块主力资金（万元→亿）
  plateFlowTop: [ { n: "通信设备", v: 88.93 }, { n: "元件", v: 46.84 }, { n: "工业金属", v: 44.43 } ],
  plateFlowBottom: [ { n: "化学制药", v: -34.05 }, { n: "医疗服务", v: -28.31 }, { n: "生物制品", v: -11.36 } ],
  mainNetIn: [ // 单日主力净流入榜（亿）
    { c: "sz300308", n: "中际旭创", v: 36.79 }, { c: "sz300502", n: "新易盛", v: 27.08 },
    { c: "sh600460", n: "士兰微", v: 11.61 }, { c: "sz002716", n: "湖南白银", v: 10.56 },
    { c: "sh600183", n: "生益科技", v: 10.46 }, { c: "sz002241", n: "歌尔股份", v: 9.56 },
    { c: "sh601899", n: "紫金矿业", v: 9.05 }, { c: "sz002463", n: "沪电股份", v: 8.07 },
    { c: "sz002396", n: "星网锐捷", v: 7.10 }, { c: "sh601212", n: "白银有色", v: 7.08 } ],
  // ④ 主线与支线：行业/概念榜
  plateTop: [ { n: "贵金属", v: 4.64, lead: "湖南白银" }, { n: "能源金属", v: 4.60, lead: "融捷股份" },
    { n: "非金属材料", v: 3.03, lead: "金博股份" }, { n: "通信设备", v: 2.98, lead: "星网锐捷" },
    { n: "元件", v: 2.80, lead: "江海股份" }, { n: "饰品", v: 2.52, lead: "深中华A" } ],
  plateBottom: [ { n: "种植业", v: -4.81 }, { n: "化学制药", v: -4.33 }, { n: "医疗服务", v: -3.75 },
    { n: "生物制品", v: -3.63 }, { n: "农产品加工", v: -3.55 } ],
  conceptTop: [ { n: "肿瘤疫苗", v: 6.24, lead: "康希诺" }, { n: "白银概念", v: 4.57, lead: "湖南白银" },
    { n: "铅锌概念", v: 4.13, lead: "湖南白银" }, { n: "陶瓷基板", v: 3.80, lead: "中瓷电子" },
    { n: "锂矿", v: 3.77, lead: "*ST威领" } ],
  conceptBottom: [ { n: "创新药", v: -3.78 }, { n: "生物医药", v: -3.33 }, { n: "健康中国", v: -2.48 } ],
  emotionRef: [ { n: "昨日连板", v: 1.85 }, { n: "昨日涨停", v: -0.66 }, { n: "昨日首板", v: -1.20 },
    { n: "昨日高换手", v: -2.14 }, { n: "龙头股", v: -2.11 } ],
  // ⑥ 涨停梯队（连板天数）
  ladder3: [ { c: "sz002667", n: "*ST威领", d: 3 }, { c: "sz002412", n: "汉森制药", d: 3 } ],
  ladder2: [ { n: "键凯科技" }, { n: "深中华A" }, { n: "贝瑞基因" }, { n: "康希诺" }, { n: "宇环数控" },
    { n: "近岸蛋白" }, { n: "双鹭药业" }, { n: "科森科技" }, { n: "通鼎互联" }, { n: "哈森股份" }, { n: "中 关 村" } ],
  ladder1Count: 45, // 58 只涨停(含ST) - 13 只连板
  // 龙虎榜：机构
  lhbInstBuy: [ { n: "山东黄金", v: 4.11, note: "3日榜" }, { n: "中瓷电子", v: 3.06 }, { n: "沃森生物", v: 2.75 },
    { n: "盛达资源", v: 2.52 }, { n: "湖南白银", v: 1.66 }, { n: "星网锐捷", v: 1.38 },
    { n: "神农种业", v: 1.17 }, { n: "通鼎互联", v: 1.13 } ],
  lhbInstSell: [ { n: "键凯科技", v: -0.98 }, { n: "华大智造", v: -0.88 }, { n: "志邦家居", v: -0.42 },
    { n: "神奇制药", v: -0.35 }, { n: "星网锐捷", v: -0.34 } ],
  // 龙虎榜：游资席位
  lhbHot: [ { seat: "深股通专用", v: 9.01, stocks: "沃森生物/湖南白银/星网锐捷" },
    { seat: "国泰海通北京知春路", v: 2.75, stocks: "星网锐捷/诺德股份" },
    { seat: "银河证券北京学院南路", v: 2.17, stocks: "沃森生物/誉衡药业/永安药业" },
    { seat: "高盛(中国)上海世纪大道", v: 2.05, stocks: "康希诺/深科达/诺德股份" },
    { seat: "国泰海通总部", v: 1.65, stocks: "深科达/金健米业/国仪公司" },
    { seat: "国盛证券宁波桑田路", v: 1.13, stocks: "康希诺" },
    { seat: "长江证券上海分公司", v: 1.12, stocks: "中瓷电子" },
    { seat: "开源证券西安高新成章路", v: 1.07, stocks: "湖南白银" } ],
};

// ===== 外部「当日快照」优先 =====
// 策略：快照 tradeDate=今天 → 直接用（MCP 或云端已缓存）；否则若为交易日且已收盘（北京时间≥15:05）→ 自动用东财公开接口抓取当日盘后数据（云端/GitHub Actions 无 MCP 时也能跑）
const bjOf = () => { const d = new Date(Date.now() + 8 * 3600 * 1000);
  return { date: d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"),
    min: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: (d.getUTCDay() + 6) % 7 + 1 }; };
const bjNow = bjOf();
let snapshotUsed = null;
try {
  const s = JSON.parse(fs.readFileSync(SNAP_FILE, "utf8"));
  if (s && s.tradeDate === bjNow.date) snapshotUsed = s;
} catch (e) {}
async function ensureSnapshot() {
  if (!snapshotUsed && bjNow.wd <= 5 && bjNow.min >= 15 * 60 + 5) {
    try {
      const cloud = require("./_fetch_review_cloud.js");
      const oldDb = JSON.parse(fs.readFileSync(DATA, "utf8"));
      snapshotUsed = await cloud.fetchReviewSnapshot(oldDb.review);
      console.log("[review] 东财公开接口抓取当日盘后数据 tradeDate=" + snapshotUsed.tradeDate);
    } catch (e) { console.log("[review] 云端抓取失败，保持旧快照:", e.message); }
  }
  if (snapshotUsed) {
    TRADE_DATE = snapshotUsed.tradeDate;
    const ext = Object.assign({}, snapshotUsed); delete ext.tradeDate;
    SNAPSHOT = Object.assign({}, SNAPSHOT, ext);
    console.log("[review] 使用当日快照 tradeDate=" + TRADE_DATE);
  } else {
    // 兜底优先沿用 data.json 现有复盘（避免把更新的复盘回写成内置历史），否则才用内置
    try {
      const db2 = JSON.parse(fs.readFileSync(DATA, "utf8"));
      if (db2.review && db2.review.tradeDate) {
        TRADE_DATE = db2.review.tradeDate;
        SNAPSHOT = Object.assign({}, SNAPSHOT, db2.review);
        console.log("[review] 无当日快照，沿用 data.json 已有复盘 (" + TRADE_DATE + ")");
        return;
      }
    } catch (e) {}
    console.log("[review] 无当日快照（未收盘/非交易日/抓取失败），回落内置历史快照 (" + TRADE_DATE + ")");
  }
}

// ===== 实时补抓：新浪外汇（美元/人民币）+ 腾讯原油 =====
function get(url, gbk) {
  return new Promise((res, rej) => {
    https.get(url, { timeout: 9000, headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.sina.com.cn" } }, (r) => {
      const ch = []; r.on("data", (c) => ch.push(c));
      r.on("end", () => res(gbk ? new TextDecoder("gbk").decode(Buffer.concat(ch)) : Buffer.concat(ch).toString("utf8")));
    }).on("error", rej);
  });
}
async function fetchFx() {
  try {
    const t = await get("https://hq.sinajs.cn/list=fx_susdcny,fx_susdcnh", true);
    const rows = {};
    for (const m of t.matchAll(/var hq_str_(fx_\w+)="([^"]*)"/g)) {
      const f = m[2].split(","); rows[m[1]] = { price: parseFloat(f[1]), name: f[9] || m[1] };
    }
    return { cny: rows.fx_susdcny ? rows.fx_susdcny.price : null, cnh: rows.fx_susdcnh ? rows.fx_susdcnh.price : null };
  } catch (e) { return { cny: null, cnh: null }; }
}
async function fetchOil() {
  try {
    const t = await get("https://qt.gtimg.cn/q=hf_CL", true);
    const m = t.match(/v_hf_CL="([^"]*)"/);
    if (!m) return null;
    const f = m[1].split("~");
    // 腾讯外盘期货：f[0]最新价? 实际格式：名称~代码~最新~... 取可用的价格与涨跌
    const price = parseFloat(f[0]) || parseFloat(f[7]);
    return price > 0 ? { price, raw: m[1].slice(0, 80) } : null;
  } catch (e) { return null; }
}

(async () => {
  await ensureSnapshot();   // 先确保快照（今日缓存优先，否则盘后自动云端抓取）
  const db = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const [fx, oil] = await Promise.all([fetchFx(), fetchOil()]);

  // ⑨ 隔夜美股：取 data.json 内美股指数（构建时已为最近收盘），带数据日期标签
  const fromCloses = (k) => { const s = db.symbols[k]; if (!s || !s.closes || s.closes.length < 2) return null;
    const price = s.closes[s.closes.length - 1], prev = s.closes[s.closes.length - 2];
    return { n: s.name, price, prev, pct: +(((price - prev) / prev) * 100).toFixed(2), d: s.dates ? s.dates[s.dates.length - 1] : "" }; };
  const us = ["100.DJI", "100.SPX", "100.IXIC", "100.NDX"].map(fromCloses).filter(Boolean);
  const hk = ["100.HSI", "100.HSTECH"].map(fromCloses).filter(Boolean);
  const goldKeys = Object.keys(db.symbols).filter((k) => db.symbols[k].group && db.symbols[k].group.indexOf("黄金") >= 0);
  const gold = goldKeys.map(fromCloses).filter(Boolean);

  // ① 新闻与消息面：取快照新闻中 L1/L2 且非传闻的重磅条目（最多8条）
  const news = (db.news || []).filter((m) => m.level !== "L3")
    .sort((a, b) => (a.level === "L1" ? 0 : 1) - (b.level === "L1" ? 0 : 1) || b.time.localeCompare(a.time))
    .slice(0, 8).map((m) => ({ time: m.time, title: m.title, level: m.level, dir: m.dir, assets: m.assets }));

  const S = SNAPSHOT;
  db.review = {
    tradeDate: TRADE_DATE,
    generatedAt: new Date().toISOString(),
    breadth: S.breadth, trade: S.trade, profile: S.profile,
    zt: S.zt || null,
    valuation: S.valuation, macro: S.macro, fx, oil,
    plateFlowTop: S.plateFlowTop, plateFlowBottom: S.plateFlowBottom, mainNetIn: S.mainNetIn,
    plateTop: S.plateTop, plateBottom: S.plateBottom, conceptTop: S.conceptTop, conceptBottom: S.conceptBottom,
    emotionRef: S.emotionRef,
    ladder3: S.ladder3, ladder2: S.ladder2, ladder1Count: S.ladder1Count,
    lhbInstBuy: S.lhbInstBuy, lhbInstSell: S.lhbInstSell, lhbHot: S.lhbHot,
    news, us, hk, gold,
  };
  fs.writeFileSync(DATA, JSON.stringify(db));
  console.log("review written:", TRADE_DATE, "| fx:", JSON.stringify(fx), "| oil:", oil ? oil.price : "N/A",
    "| us:", us.map((x) => x.n + " " + x.pct + "%").join(", "));
})();
