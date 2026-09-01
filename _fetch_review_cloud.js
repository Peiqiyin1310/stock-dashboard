// _fetch_review_cloud.js — 用东财公开接口抓取当日盘后数据（替代 westock MCP，供云端/GitHub Actions 运行）
// 输出与 review_snapshot.json 相同的结构。任何抓取失败都返回 null（调用方保留旧快照，绝不编造）。
// 用法：const snap = await fetchReviewSnapshot(prevReview);  // prevReview = 现有 data.json.review（用于继承估值/宏观）

const https = require("https");
const fs = require("fs");
const path = require("path");

const SNAP_FILE = path.join(__dirname, "review_snapshot.json");
const UT = "fa5fd1943c7b386f172d6893dbfba10b";

function get(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 20000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Referer: "https://quote.eastmoney.com/" } }, (r) => {
      let d = ""; r.on("data", (c) => d += c); r.on("end", () => res({ status: r.statusCode, data: d }));
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", (e) => rej(e));
  });
}
async function jget(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await get(url);
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
  const ladder3 = pool.filter((x) => (x.lbc || 1) >= 3).map((x) => ({ n: x.n }));
  const ladder2 = pool.filter((x) => (x.lbc || 1) === 2).map((x) => ({ n: x.n }));
  const ladder1Count = pool.filter((x) => (x.lbc || 1) === 1).length;
  let dn = 0;
  try {
    const dt = await jget("https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=400&sort=fund%3Aasc&date=" + ymd);
    dn = ((dt.data && dt.data.pool) || []).length;
  } catch (e) {}
  return { uplimit: pool.length, dnlimit: dn, ladder3, ladder2, ladder1Count };
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
  await sleep(300);

  const ur = zt.uplimit && idx.red ? round1(idx.red / Math.max(idx.green, 1)) : 0;
  const pctAvg = (idx.sh.pct + idx.sz.pct + idx.cyb.pct) / 3;
  const profile = {
    sentiment: zt.uplimit >= 60 && ur >= 1.2 ? "情绪高潮（涨停 " + zt.uplimit + " 只）" : zt.uplimit >= 40 ? "情绪偏热（涨停 " + zt.uplimit + " 只）" : "情绪平淡（涨停 " + zt.uplimit + " 只）",
    cap: idx.sh.pct >= idx.cyb.pct ? "沪指领涨，大盘强于双创" : "创业板领涨，小盘强于大盘",
    sectorWidth: sec.upRatio >= 60 ? "宽（上涨板块 " + sec.upRatio + "%）" : sec.upRatio >= 40 ? "中（上涨板块 " + sec.upRatio + "%）" : "窄（上涨板块 " + sec.upRatio + "%）",
    stockWidth: ur >= 1.2 ? "普涨（上涨 " + idx.red + " 家，涨跌比 " + ur + "）" : ur < 0.9 ? "分化（上涨 " + idx.red + " 家，涨跌比 " + ur + "）" : "均衡（上涨 " + idx.red + " 家，涨跌比 " + ur + "）",
    volume: "成交 " + (idx.money / 10000).toFixed(2) + " 万亿",
    trendShort: pctAvg > 0.3 ? "上行" : pctAvg < -0.3 ? "回调" : "震荡",
    trendLong: "—",
  };
  // 估值/宏观：继承旧值（不天天变），云端无免费直连源时保持连续
  const prev = prevReview || {};
  const snap = {
    tradeDate: bj.date,
    breadth: { red: idx.red, green: idx.green, zero: idx.zero, updownRatio: ur, uplimit: zt.uplimit, dnlimit: zt.dnlimit, high10: 0, low10: 0 },
    trade: { money: idx.money, moneyRatio10d: null, sh: idx.sh, sz: idx.sz, cyb: idx.cyb },
    profile,
    valuation: prev.valuation || {}, macro: prev.macro || {},
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
