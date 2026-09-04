// _fetch_review_cloud.js — 用东财公开接口抓取当日盘后数据（替代 westock MCP，供云端/GitHub Actions 运行）
// 输出与 review_snapshot.json 相同的结构。任何抓取失败都返回 null（调用方保留旧快照，绝不编造）。
// 用法：const snap = await fetchReviewSnapshot(prevReview);  // prevReview = 现有 data.json.review（用于继承估值/宏观）

const https = require("https");
const fs = require("fs");
const path = require("path");

const SNAP_FILE = path.join(__dirname, "review_snapshot.json");
const UT = "fa5fd1943c7b386f172d6893dbfba10b";

function get(url, extraHeaders) {
  return new Promise((res, rej) => {
    const headers = Object.assign(
      { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Referer: "https://quote.eastmoney.com/" },
      extraHeaders || {}
    );
    const req = https.get(url, { timeout: 20000, headers }, (r) => {
      let d = ""; r.on("data", (c) => d += c); r.on("end", () => res({ status: r.statusCode, data: d }));
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", (e) => rej(e));
  });
}
async function jget(url, tries = 3, extraHeaders) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await get(url, extraHeaders);
      if (r.status === 200) return JSON.parse(r.data);
      last = new Error("http " + r.status);
    } catch (e) { last = e; }
    await sleep(700 + i * 500);   // 接口对高频请求会断连，退避重试
  }
  throw last || new Error("fetch failed");
}
/* push2 限流时自动切 push2delay（同一路径两个域） */
async function jgetAny(pathAndQuery, tries = 2) {
  let last;
  for (const host of ["https://push2.eastmoney.com", "https://push2delay.eastmoney.com"]) {
    try { return await jget(host + pathAndQuery, tries); } catch (e) { last = e; }
  }
  throw last || new Error("fetch failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yi = (v) => v == null ? 0 : +(v / 1e8).toFixed(2);          // 元 → 亿
const round1 = (v) => v == null ? 0 : +(+v).toFixed(1);
const round2 = (v) => v == null ? null : +(+v).toFixed(2);
const round4 = (v) => v == null ? null : +(+v).toFixed(4);

/* 北京时间减去 N 天，返回 YYYY-MM-DD */
function bjDateMinus(n) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 - n * 86400000);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

/* ===== 估值：中证全指(000985) 官方 PE + 历史分位 =====
   中证指数官网公开接口，返回每日 peg(市盈率) 序列，可自行计算 3/5/10 年分位。
   替代此前"无源时继承旧值"的做法，保证估值每天真实更新。 */
async function fetchValuation() {
  const end = bjNow().ymd;                                   // 20260904
  const start = (parseInt(end.slice(0, 4)) - 10) + end.slice(4);  // 十年前
  const url = "https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=000985&startDate=" + start + "&endDate=" + end;
  const j = await jget(url, 2, { Referer: "https://www.csindex.com.cn/" });
  const rows = (j && j.data) || [];
  const s = rows
    .filter((x) => x && x.tradeDate && x.peg != null && x.peg > 0)
    .map((x) => [String(x.tradeDate), +x.peg])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (s.length < 60) return null;                            // 数据太少视为失败
  const lastDay = s[s.length - 1][0];
  const pe = round2(s[s.length - 1][1]);
  /* 分位：窗口内「小于等于当前 PE」的样本占比 */
  const pctIn = (years) => {
    const cut = String(parseInt(end.slice(0, 4)) - years) + end.slice(4);
    const win = s.filter((x) => x[0] >= cut).map((x) => x[1]);
    if (win.length < 60) return null;
    return round1((win.filter((v) => v <= pe).length / win.length) * 100);
  };
  return {
    pe,
    pePct3y: pctIn(3), pePct5y: pctIn(5), pePct10y: pctIn(10),
    pb: null, div: null,                                     // 中证接口无 PB/股息率，页面不展示
    date: lastDay.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
    src: "中证指数官网",
  };
}

/* ===== 宏观：中债国债收益率曲线（中债登官方） =====
   页面表格列顺序固定：3月, 6月, 1年, 3年, 5年, 7年, 10年, 30年。
   2 年期官网不公布，用 1 年与 3 年线性插值得到。 */
async function fetchMacro() {
  for (let d = 0; d < 7; d++) {                              // 非交易日往前回溯
    const dt = bjDateMinus(d);
    try {
      const url = "https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/queryGjqxInfo?workTime=" + dt + "&locale=zh_CN";
      const r = await get(url, { Referer: "https://yield.chinabond.com.cn/" });
      if (r.status !== 200) continue;
      const h = r.data || "";
      const rowM = h.match(/中债国债收益率曲线[\s\S]{0,1500}?<\/tr>/);
      const dateM = h.match(/<th>(\d{4}-\d{2}-\d{2})\(%\)<\/th>/);
      if (!rowM) continue;
      const tds = [...rowM[0].matchAll(/<td>\s*([0-9.]+)\s*<\/td>/g)].map((x) => parseFloat(x[1]));
      if (tds.length < 8) continue;
      const y1 = tds[2], y3 = tds[3], y10 = tds[6];
      const cn2y = round4((y1 + y3) / 2);
      const cn10y = round4(y10);
      const termSpread = round1((cn10y - cn2y) * 100);
      return {
        cn10y, cn2y, termSpread,
        curveFormD: termSpread >= 80 ? "牛陡" : termSpread >= 40 ? "中性偏陡" : termSpread >= 20 ? "中性" : "熊平",
        date: dateM ? dateM[1] : dt,
        src: "中债登",
      };
    } catch (e) { /* 换上一天 */ }
  }
  return null;
}

/* 北京时间（云端 runner 可能是 UTC，统一按 UTC+8 计算） */
function bjNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return {
    date: d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"),
    ymd: String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0"),
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
    wd: (d.getUTCDay() + 6) % 7 + 1,   // 1=周一 … 7=周日
  };
}

async function fetchIndex() {
  const j = await jgetAny("/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006&ut=" + UT + "&fields=f2,f3,f4,f6,f12,f104,f105,f106");
  const rows = (j.data && j.data.diff) || [];
  const getIdx = (code) => rows.find((x) => x.f12 === code);
  const sh = getIdx("000001"), sz = getIdx("399001"), cyb = getIdx("399006");
  if (!sh || !sz || !cyb) throw new Error("index data missing");
  return {
    sh: { close: sh.f2, pct: sh.f3 },
    sz: { close: sz.f2, pct: sz.f3 },
    cyb: { close: cyb.f2, pct: cyb.f3 },
    money: yi((sh.f6 || 0) + (sz.f6 || 0)),      // 两市成交额（亿）
    red: (sh.f104 || 0) + (sz.f104 || 0),          // 上涨家数（沪+深）
    green: (sh.f105 || 0) + (sz.f105 || 0),
    zero: (sh.f106 || 0) + (sz.f106 || 0),
  };
}

async function fetchZtDt(ymd) {
  const zt = await jget("https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=400&sort=fbt%3Aasc&date=" + ymd);
  const pool = (zt.data && zt.data.pool) || [];
  const ladder3 = pool.filter((x) => (x.lbc || 1) >= 3).map((x) => ({ n: x.n, d: x.lbc || 1 }));
  const ladder2 = pool.filter((x) => (x.lbc || 1) === 2).map((x) => ({ n: x.n }));
  const ladder1Count = pool.filter((x) => (x.lbc || 1) === 1).length;
  let dn = 0, zbc = null;
  try {
    const dt = await jget("https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=400&sort=fund%3Aasc&date=" + ymd);
    dn = ((dt.data && dt.data.pool) || []).length;
  } catch (e) {}
  try {
    const zb = await jget("https://push2ex.eastmoney.com/getTopicZBPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=400&sort=fbt%3Aasc&date=" + ymd);
    zbc = ((zb.data && zb.data.pool) || []).length;
  } catch (e) {}
  const maxLbc = pool.reduce((m, x) => Math.max(m, x.lbc || 1), 0);
  const zbrate = zbc != null && (pool.length + zbc) > 0 ? round1((zbc / (pool.length + zbc)) * 100) : null;
  return { uplimit: pool.length, dnlimit: dn, zbc, zbrate, maxLbc, ladder3, ladder2, ladder1Count };
}

/* 昨日（或最近一个交易日）涨停家数，用于情绪环比 */
async function fetchPrevUplimit() {
  for (let d = 1; d <= 4; d++) {
    try {
      const ymd = bjDateMinus(d).replace(/-/g, "");
      const j = await jget("https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=400&sort=fbt%3Aasc&date=" + ymd);
      const n = ((j.data && j.data.pool) || []).length;
      if (n > 0) return n;
    } catch (e) { /* 继续往前找 */ }
  }
  return null;
}

/* 量能对比：上证+深成 K 线成交量（腾讯源，手），今日 vs 前 5/10 日均量（%）
   口径说明：腾讯日 K 无成交额历史，量比按成交量计算，与金额口径方向一致 */
async function fetchVolRatio() {
  const today = bjDateMinus(0);
  const beg = bjDateMinus(30);
  const volOf = async (code) => {
    const u = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + code + ",day," + beg + "," + today + ",20,qfq";
    const r = await get(u, { Referer: "https://gu.qq.com/" });
    const j = JSON.parse(r.data);
    const node = j.data[Object.keys(j.data)[0]];
    const arr = node.qfqday || node.day || [];
    return arr.map((x) => parseFloat(x[5]));
  };
  const [v1, v2] = await Promise.all([volOf("sh000001"), volOf("sz399001")]);
  const n = Math.min(v1.length, v2.length);
  if (n < 11) return null;
  const tot = [];
  for (let i = 0; i < n; i++) tot.push((v1[v1.length - n + i] || 0) + (v2[v2.length - n + i] || 0));
  const todayV = tot[tot.length - 1];
  if (!(todayV > 0)) return null;
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const prev5 = avg(tot.slice(-6, -1));
  const prev10 = avg(tot.slice(-11, -1));
  if (!(prev5 > 0) || !(prev10 > 0)) return null;
  return { r5: Math.round((todayV / prev5) * 100), r10: Math.round((todayV / prev10) * 100) };
}

async function fetchSectors() {
  const F = "f2,f3,f12,f14,f62,f184";
  // 行业：取全量（约90+个），按涨跌幅取前6/后6；按主力净流入取前6/后6
  const up = await jgetAny("/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&ut=" + UT + "&fields=" + F);
  const rows = ((up.data && up.data.diff) || []).filter((x) => x.f14);
  const plateTop = rows.slice(0, 6).map((x) => ({ n: x.f14, v: round1(x.f3), lead: x.f184 || "" }));
  const plateBottom = rows.slice(-6).reverse().map((x) => ({ n: x.f14, v: round1(x.f3), lead: x.f184 || "" }));
  const flowRows = rows.slice().sort((a, b) => (b.f62 || 0) - (a.f62 || 0));
  const plateFlowTop = flowRows.slice(0, 6).map((x) => ({ n: x.f14, v: yi(x.f62) }));
  const plateFlowBottom = flowRows.slice(-6).reverse().map((x) => ({ n: x.f14, v: yi(x.f62) }));
  // 概念：取全量，前5/后3
  const con = await jgetAny("/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:3+f:!50&ut=" + UT + "&fields=" + F);
  const crows = ((con.data && con.data.diff) || []).filter((x) => x.f14);
  const conceptTop = crows.slice(0, 5).map((x) => ({ n: x.f14, v: round1(x.f3), lead: x.f184 || "" }));
  const conceptBottom = crows.slice(-3).reverse().map((x) => ({ n: x.f14, v: round1(x.f3), lead: x.f184 || "" }));
  const upRatio = rows.length ? round1(rows.filter((x) => x.f3 > 0).length / rows.length * 100) : 0;
  return { plateTop, plateBottom, plateFlowTop, plateFlowBottom, conceptTop, conceptBottom, upRatio };
}

async function fetchMainNet() {
  try {
    const j = await jget("https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=10&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:0+t:6&ut=" + UT + "&fields=f12,f14,f62");
    return ((j.data && j.data.diff) || []).map((x) => ({ n: x.f14, v: yi(x.f62) }));
  } catch (e) { return []; }
}

async function fetchLhb(dateDash) {
  const u = "https://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=BILLBOARD_NET_AMT&sortTypes=-1&pageSize=50&pageNumber=1&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,BILLBOARD_NET_AMT&filter=(TRADE_DATE%3D%27" + dateDash + "%27)";
  const j = await jget(u, 2);
  const seen = new Set();
  const rows = ((j.result && j.result.data) || []).filter((x) => x.SECURITY_NAME_ABBR && !seen.has(x.SECURITY_NAME_ABBR) && (seen.add(x.SECURITY_NAME_ABBR), true));
  const buy = rows.slice(0, 5).map((x) => ({ n: x.SECURITY_NAME_ABBR, v: yi(x.BILLBOARD_NET_AMT) }));
  const sell = rows.slice(-5).reverse().map((x) => ({ n: x.SECURITY_NAME_ABBR, v: yi(x.BILLBOARD_NET_AMT) }));
  return { lhbInstBuy: buy, lhbInstSell: sell };
}

async function fetchReviewSnapshot(prevReview) {
  const bj = bjNow();
  const idx = await fetchIndex();
  const zt = await fetchZtDt(bj.ymd);
  const sec = await fetchSectors();
  const main = await fetchMainNet();
  const lhb = await fetchLhb(bj.date);
  const [prevUp, vr] = await Promise.all([
    fetchPrevUplimit().catch(() => null),
    fetchVolRatio().catch(() => null),
  ]);
  await sleep(300);

  /* 情绪阶段（规则判定）：涨停家数环比 + 炸板率 + 连板高度 */
  const up = zt.uplimit, zb = zt.zbrate == null ? 20 : zt.zbrate;
  let stage = "正常";
  if (up < 20) stage = "冰点";
  else if (prevUp != null && up < prevUp * 0.7 && zb > 30) stage = "退潮";
  else if (up >= 60 && zb < 25 && zt.maxLbc >= 5) stage = "高潮";
  else if (prevUp != null && up > prevUp && zb < 25) stage = "发酵";
  else if (zb > 35) stage = "分歧";
  console.log("[review] 涨停 " + up + " 只（昨日 " + (prevUp != null ? prevUp : "?") + "）· 炸板 " + zt.zbc + "（" + zb + "%）· 最高 " + zt.maxLbc + " 板 · 阶段=" + stage);
  if (vr) console.log("[review] 量能：5日均量 " + vr.r5 + "% · 10日均量 " + vr.r10 + "%（成交量口径）");

  const ur = zt.uplimit && idx.red ? round1(idx.red / Math.max(idx.green, 1)) : 0;
  const pctAvg = (idx.sh.pct + idx.sz.pct + idx.cyb.pct) / 3;
  const profile = {
    sentiment: stage + "（涨停 " + zt.uplimit + " 只" + (zt.zbrate != null ? "，炸板率 " + zt.zbrate + "%" : "") + "）",
    cap: idx.sh.pct >= idx.cyb.pct ? "沪指领涨，大盘强于双创" : "创业板领涨，小盘强于大盘",
    sectorWidth: sec.upRatio >= 60 ? "宽（上涨板块 " + sec.upRatio + "%）" : sec.upRatio >= 40 ? "中（上涨板块 " + sec.upRatio + "%）" : "窄（上涨板块 " + sec.upRatio + "%）",
    stockWidth: ur >= 1.2 ? "普涨（上涨 " + idx.red + " 家，涨跌比 " + ur + "）" : ur < 0.9 ? "分化（上涨 " + idx.red + " 家，涨跌比 " + ur + "）" : "均衡（上涨 " + idx.red + " 家，涨跌比 " + ur + "）",
    volume: "成交 " + (idx.money / 10000).toFixed(2) + " 万亿",
    trendShort: pctAvg > 0.3 ? "上行" : pctAvg < -0.3 ? "回调" : "震荡",
    trendLong: "—",
  };
  // 估值/宏观：抓中证官方 PE 与中债登收益率曲线；仅当抓取失败时才继承旧值（保证连续、绝不编造）
  const prev = prevReview || {};
  const [val, mac] = await Promise.all([
    fetchValuation().catch(() => null),
    fetchMacro().catch(() => null),
  ]);
  if (val) console.log("[review] 估值：中证全指 PE " + val.pe + " 倍 · 10年分位 " + val.pePct10y + "% · " + val.date);
  else console.log("[review] 估值抓取失败，沿用既有值");
  if (mac) console.log("[review] 宏观：10年期国债 " + mac.cn10y + "% · 期限利差 " + mac.termSpread + "bps · " + mac.date);
  else console.log("[review] 宏观抓取失败，沿用既有值");
  const snap = {
    tradeDate: bj.date,
    breadth: { red: idx.red, green: idx.green, zero: idx.zero, updownRatio: ur, uplimit: zt.uplimit, dnlimit: zt.dnlimit, high10: 0, low10: 0 },
    trade: { money: idx.money, moneyRatio5d: vr ? vr.r5 : null, moneyRatio10d: vr ? vr.r10 : null, sh: idx.sh, sz: idx.sz, cyb: idx.cyb },
    zt: { uplimit: zt.uplimit, dnlimit: zt.dnlimit, zbc: zt.zbc, zbrate: zt.zbrate, maxLbc: zt.maxLbc, prevUplimit: prevUp, l1: zt.ladder1Count, l2c: zt.ladder2.length, l3c: zt.ladder3.length, stage },
    profile,
    valuation: val || prev.valuation || {}, macro: mac || prev.macro || {},
    plateFlowTop: sec.plateFlowTop, plateFlowBottom: sec.plateFlowBottom, mainNetIn: main,
    plateTop: sec.plateTop, plateBottom: sec.plateBottom, conceptTop: sec.conceptTop, conceptBottom: sec.conceptBottom,
    emotionRef: {},
    ladder3: zt.ladder3, ladder2: zt.ladder2, ladder1Count: zt.ladder1Count,
    lhbInstBuy: lhb.lhbInstBuy, lhbInstSell: lhb.lhbInstSell, lhbHot: [],
  };
  // 落盘缓存（下个 10 分钟周期直接复用，避免重复抓取）
  try { fs.writeFileSync(SNAP_FILE, JSON.stringify(snap)); } catch (e) {}
  return snap;
}

module.exports = { fetchReviewSnapshot, bjNow };
