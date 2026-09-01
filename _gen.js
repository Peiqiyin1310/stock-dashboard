const https = require("https");
const fs = require("fs");

// ===== 标的清单 =====
// Tencent appstock kline code -> {group, name}
const SYMS = [
  // —— 美股 ——
  { code: "us.DJI",    key: "100.DJI",    group: "美股",     name: "道琼斯" },
  { code: "us.INX",    key: "100.SPX",    group: "美股",     name: "标普500" },
  { code: "us.IXIC",   key: "100.IXIC",   group: "美股",     name: "纳斯达克" },
  { code: "us.NDX",    key: "100.NDX",    group: "美股",     name: "纳指100" },
  // —— 大A / 港股 / 固收 ——
  { code: "sh000001",  key: "1.000001",   group: "大A",      name: "上证指数" },
  { code: "sz399001",  key: "0.399001",   group: "大A",      name: "深证成指" },
  { code: "sz399006",  key: "0.399006",   group: "大A",      name: "创业板指" },
  { code: "sh000300",  key: "1.000300",   group: "大A",      name: "沪深300" },
  { code: "sh000922",  key: "1.000922",   group: "大A·红利", name: "中证红利" },
  { code: "sh000905",  key: "1.000905",   group: "大A·宽基", name: "中证500" },
  { code: "sh000012",  key: "1.000012",   group: "固收",     name: "国债指数" },
  { code: "sh000832",  key: "1.000832",   group: "固收",     name: "中证转债" },
  { code: "hkHSI",     key: "100.HSI",    group: "港股",     name: "恒生指数" },
  { code: "hkHSTECH",  key: "100.HSTECH", group: "港股",     name: "恒生科技" },
  // —— 黄金 ——
  { code: "sh518880",  key: "300.AU",     group: "黄金",     name: "黄金ETF·人民币(跟踪上海金Au99.99)" },
  { code: "sz159321",  key: "300.AGS",    group: "黄金",     name: "黄金股ETF·矿业股(弹性>金价)" },
  // —— QDII·主题（芯片/半导体，CPO/存储以主题ETF代表）——
  { code: "sz159995",  key: "300.CHIP",   group: "芯片",     name: "芯片ETF(国联安)" },
  { code: "sh512480",  key: "300.SEMI",   group: "半导体",   name: "半导体ETF(国联安)" },
  { code: "sh512760",  key: "300.SDEQ",   group: "半导体设备", name: "半导体设备ETF" },
  { code: "sh588200",  key: "300.STAR",   group: "科创芯片", name: "科创芯片ETF" },
  // —— 自选·个股 ——
  { code: "sh600036",  key: "1.600036",   group: "自选·个股", name: "招商银行" },
  { code: "sh601318",  key: "1.601318",   group: "自选·个股", name: "中国平安" },
  { code: "sh600900",  key: "1.600900",   group: "自选·个股", name: "长江电力" },
  { code: "sh601398",  key: "1.601398",   group: "自选·个股", name: "工商银行" },
  { code: "sh601166",  key: "1.601166",   group: "自选·个股", name: "兴业银行" },
  // —— 每日复盘·行业指数（中证一级行业 + 主题）——
  { code: "sh000928",  key: "1.000928",   group: "行业",     name: "中证能源" },
  { code: "sh000929",  key: "1.000929",   group: "行业",     name: "中证材料" },
  { code: "sh000930",  key: "1.000930",   group: "行业",     name: "中证工业" },
  { code: "sh000931",  key: "1.000931",   group: "行业",     name: "中证可选" },
  { code: "sh000932",  key: "1.000932",   group: "行业",     name: "中证消费" },
  { code: "sh000933",  key: "1.000933",   group: "行业",     name: "中证医药" },
  { code: "sh000934",  key: "1.000934",   group: "行业",     name: "中证金融" },
  { code: "sh000935",  key: "1.000935",   group: "行业",     name: "中证信息" },
  { code: "sh000936",  key: "1.000936",   group: "行业",     name: "中证电信" },
  { code: "sh000937",  key: "1.000937",   group: "行业",     name: "中证公用" },
  { code: "sz399997",  key: "0.399997",   group: "行业",     name: "中证白酒" },
  { code: "sz399989",  key: "0.399989",   group: "行业",     name: "中证医疗" },
];
// 场外 QDII 基金（净值源：天天基金 pingzhongdata，无 K 线，用单位净值序列）
const FUNDS = [
  { code: "018147", key: "OF.018147", group: "自选·QDII", name: "建信新兴市场(QDII) C" },
  { code: "019305", key: "OF.019305", group: "自选·QDII", name: "摩根标普500(QDII) C" },
  { code: "016453", key: "OF.016453", group: "自选·QDII", name: "南方纳指100(QDII) C" },
  { code: "017731", key: "OF.017731", group: "自选·QDII", name: "嘉实全球产业升级(QDII) C" },
];
// 实时报价卡（现货/外汇，无历史K线，快照抓一口价）
const QUOTEONLY = [
  { code: "hf_XAU", key: "300.XAU", group: "黄金数据", name: "伦敦金现·美元现货(XAU/USD)" },
  { code: "hf_XAG", key: "300.XAG", group: "黄金数据", name: "国际银现·美元现货(XAG/USD)" },
];

const END = "2026-08-22";
function startDate() {
  const d = new Date("2026-08-22T00:00:00Z");
  d.setDate(d.getDate() - 400);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function get(url, headers) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 15000, headers: Object.assign({ "User-Agent": "Mozilla/5.0" }, headers || {}) }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, data: d }));
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", e => rej(e));
  });
}
function num(s) { return parseFloat(s); }

async function fetchKline(code) {
  const beg = startDate();
  const u = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,${beg},${END},320,qfq`;
  const r = await get(u);
  const j = JSON.parse(r.data);
  const k = Object.keys(j.data || {});
  if (!k.length) throw new Error("no key");
  const node = j.data[k[0]];
  const arr = node.qfqday || node.day || node.kline || node.qfqkline || [];
  if (!arr.length) throw new Error("empty");
  let kl = arr.map(x => Array.isArray(x) ? x : x.split(","));
  if (kl.length > 130) kl = kl.slice(-130);
  // 脏数据防护：最后一根收盘与前一根偏离 >30%（如 us.NDX 当日错价 13.1 vs 29213），整根丢弃
  while (kl.length >= 2) {
    const last = num(kl[kl.length - 1][2]), prev = num(kl[kl.length - 2][2]);
    if (prev > 0 && Math.abs(last / prev - 1) > 0.3) { kl = kl.slice(0, -1); console.log(`  [sanity] ${code}: dropped bad bar (${last} vs ${prev})`); }
    else break;
  }
  return {
    closes: kl.map(x => num(x[2])),
    highs: kl.map(x => num(x[3])),
    lows: kl.map(x => num(x[4])),
    vols: kl.map(x => num(x[5])),
    opens: kl.map(x => num(x[1])),
    dates: kl.map(x => x[0]),
    bars: kl.length,
  };
}

// 场外基金：天天基金 pingzhongdata 的 Data_netWorthTrend（单位净值序列）
async function fetchNav(code) {
  const u = `https://fund.eastmoney.com/pingzhongdata/${code}.js`;
  const r = await get(u, { "Referer": "https://fund.eastmoney.com/" });
  const m = r.data.match(/Data_netWorthTrend\s*=\s*(\[.*?\]);/s);
  if (!m) throw new Error("no nav trend");
  const arr = JSON.parse(m[1]);
  if (!arr.length) throw new Error("empty nav");
  let pts = arr.map(p => ({ t: new Date(p.x).toISOString().slice(0, 10), v: num(p.y) })).filter(p => p.v > 0);
  if (pts.length > 130) pts = pts.slice(-130);
  return {
    closes: pts.map(p => p.v),
    highs: pts.map(p => p.v),
    lows: pts.map(p => p.v),
    vols: pts.map(() => 0),
    opens: pts.map(p => p.v),
    dates: pts.map(p => p.t),
    bars: pts.length,
  };
}

async function fetchQuote(code) {
  const u = `https://qt.gtimg.cn/q=${code}`;
  const r = await get(u);
  const m = r.data.match(new RegExp(`v_${code}="([^"]*)"`));
  if (!m) throw new Error("no quote field");
  const f = m[1].split(",");
  const cur = parseFloat(f[0]);
  if (!(cur > 0)) throw new Error("bad price");
  const prev = parseFloat(f[7]);
  return { price: cur, prev: prev > 0 ? prev : null };
}
// 美元人民币汇率（新浪外汇，GBK 编码，需二进制收集后转码）
function getBuf(url, headers) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 12000, headers: Object.assign({ "User-Agent": "Mozilla/5.0" }, headers || {}) }, r => {
      const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => res({ status: r.statusCode, buf: Buffer.concat(ch) }));
    });
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.on("error", e => rej(e));
  });
}
async function fetchFx() {
  const r = await getBuf("https://hq.sinajs.cn/list=fx_susdcny,fx_susdcnh", { "Referer": "https://finance.sina.com.cn" });
  const txt = new TextDecoder("gbk").decode(r.buf);
  const out = {};
  for (const [code, key, name] of [["fx_susdcny", "usdcny", "在岸人民币 USD/CNY"], ["fx_susdcnh", "usdcnh", "离岸人民币 USD/CNH"]]) {
    const m = txt.match(new RegExp(`hq_str_${code}="([^"]*)"`));
    if (!m) throw new Error("no fx " + code);
    const f = m[1].split(",");
    const price = parseFloat(f[3]) || parseFloat(f[1]);
    if (!(price > 0)) throw new Error("bad fx price");
    out[key] = { name, price, time: f[0], date: f[f.length - 1] || "" };
  }
  return out;
}

(async () => {
  const symbols = {};
  let ok = 0;
  for (const s of SYMS) {
    try {
      const d = await fetchKline(s.code);
      symbols[s.key] = { group: s.group, name: s.name, src: "tencent", ...d };
      ok++;
      console.log(`OK  ${s.key} (${s.name}) bars=${d.bars} last=${d.closes[d.closes.length - 1]}`);
    } catch (e) {
      console.log(`FAIL ${s.key} (${s.name}): ${e.message}`);
      symbols[s.key] = { group: s.group, name: s.name, noData: true };
    }
  }
  for (const f of FUNDS) {
    try {
      const d = await fetchNav(f.code);
      symbols[f.key] = { group: f.group, name: f.name, src: "eastmoney-fund", fund: true, ...d };
      ok++;
      console.log(`OK  ${f.key} (${f.name}) nav=${d.bars} last=${d.closes[d.closes.length - 1]}`);
    } catch (e) {
      console.log(`FAIL ${f.key} (${f.name}): ${e.message}`);
      symbols[f.key] = { group: f.group, name: f.name, noData: true };
    }
  }
  for (const q of QUOTEONLY) {
    try {
      const d = await fetchQuote(q.code);
      symbols[q.key] = { group: q.group, name: q.name, quoteOnly: true, price: d.price, prev: d.prev, src: "tencent" };
      console.log(`QO  ${q.key} (${q.name}) price=${d.price}`);
    } catch (e) {
      symbols[q.key] = { group: q.group, name: q.name, quoteOnly: true, price: null, src: "tencent" };
      console.log(`QO  ${q.key} (${q.name}) price=null (${e.message})`);
    }
  }
  // 美元人民币汇率（每日复盘·外汇）
  let fx = null;
  try {
    fx = await fetchFx();
    console.log(`FX  USD/CNY 在岸 ${fx.usdcny.price} / 离岸 ${fx.usdcnh.price} (${fx.usdcny.date})`);
  } catch (e) { console.log(`FX  fail: ${e.message}`); }
  // 合并写入：保留 news / newsUpdated / review / calendar 等其它生成器写入的字段，
  // 只更新行情相关字段（updated / source / symbols / fx），避免覆盖快讯 / 复盘 / 日历数据。
  const DATA = require("path").join(__dirname, "stock-dashboard", "data.json");
  let db = {};
  try { db = JSON.parse(fs.readFileSync(DATA, "utf8")); } catch (e) {}
  db.updated = new Date().toISOString();
  db.source = "腾讯财经行情 + 天天基金净值 + 新浪外汇";
  db.symbols = symbols;
  db.fx = fx;
  fs.writeFileSync(DATA, JSON.stringify(db));
  console.log(`\nWROTE data.json — ${ok}/${SYMS.length + FUNDS.length} symbols with data, ${QUOTEONLY.length} quote-only.`);
})();
