const fs = require("fs");
const dir = require("path").join(__dirname, "stock-dashboard");
const html = fs.readFileSync(dir + "/index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const store = {};
/* 真实浏览器语义：仅初始 HTML 中存在的元素可被 getElementById 找到，否则返回 null
   （动态写入 innerHTML 的元素在真实 DOM 也可找到，但桩无法解析 innerHTML，调用方须判空） */
const KNOWN_IDS = new Set();
{ const re = /id="([^"]+)"/g; let m; while ((m = re.exec(html))) KNOWN_IDS.add(m[1]); }
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = {
  getElementById: (id) => {
    if (!KNOWN_IDS.has(id)) return null;
    if (!store[id]) store[id] = { textContent: "", innerHTML: "", style: {}, className: "", dataset: {}, checked: true, value: "60000", appendChild(){}, removeChild(){}, querySelectorAll: () => [], querySelector: () => null, classList: { add(){}, remove(){} }, addEventListener(){}, removeEventListener(){}, set onclick(f){}, set onchange(f){}, set oninput(f){}, set onkeydown(f){}, set onmousemove(f){}, set onmouseleave(f){}, setAttribute(){}, getAttribute:()=>null };
    return store[id];
  },
  createElement: () => ({ set src(v){}, set onload(f){}, set onerror(f){}, style:{} }),
  body: { appendChild(){}, removeChild(){} },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener(){},
  removeEventListener(){},
};
global.window = { addEventListener(){}, removeEventListener(){}, scrollTo(){}, requestAnimationFrame: (f)=>f&&f() };
global.setInterval = () => 0;
global.clearInterval = () => {};
global.setTimeout = () => 0;
global.fetch = () => Promise.reject(new Error("no net in stub"));
global.alert = () => {};

// 消息面联动单元测试（与页面脚本同一 eval 作用域，可访问 let NEWS 等）
const TEST_TAIL = `
;(function(){
  var out=[];
  // 核心回归：综合分 → 信号标签统一映射（修复 -2 显示"持有"的 bug）
  out.push('映射 -2='+sigFromTotal(-2)+' -1='+sigFromTotal(-1)+' 0='+sigFromTotal(0)+' 1='+sigFromTotal(1)+' 2='+sigFromTotal(2)+' 3='+sigFromTotal(3)+' 3.5='+sigFromTotal(3.5)+' -4='+sigFromTotal(-4));
  // 临时注入测试消息（正式环境默认无演示消息）
  NEWS.push({id:'t1',time:'2026-08-21',title:'测试-芯片强利空',level:'L1',dir:'强利空',assets:['芯片'],type:'policy',days:7,source:'测试'});
  NEWS.push({id:'t2',time:'2026-08-21',title:'测试-黄金利多',level:'L1',dir:'利多',assets:['黄金'],type:'policy',days:7,source:'测试'});
  // 场景1：技术买入(+2) + L1强利空(-1.5) → 0.5 → 持有 + 冲突预警
  var c1=combineSignal({sig:'买入'},'300.CHIP');
  out.push('芯片-买入-L1强利空 base='+c1.base+' adj='+c1.adj.toFixed(1)+' total='+c1.total.toFixed(1)+' sig='+c1.sig+' conflict='+c1.conflict);
  // 场景2：持有(0) + L1利多(+1) → +1 → 买入（消息确认转多）
  var c2=combineSignal({sig:'持有'},'300.AU');
  out.push('黄金-持有-L1利多 base='+c2.base+' adj='+c2.adj+' total='+c2.total+' sig='+c2.sig);
  // 场景3：持有(0) + 无消息 → 持有
  var c3=combineSignal({sig:'持有'},'1.000922');
  out.push('红利-持有-无消息 total='+c3.total+' sig='+c3.sig);
  // 场景4：L3 传闻不计分
  out.push('L3传闻计分 score='+msgScore({level:'L3',dir:'利空'}));
  // 场景5：突发自动置顶判定 + 手动置顶/取消置顶
  var autoMsg={id:'x1',time:'2026-08-21 10:00',auto:true,level:'L1',dir:'强利空',assets:['全市场']};
  var normalMsg={id:'x2',time:'2026-08-21 10:05',auto:true,level:'L2',dir:'利多',assets:['大A']};
  out.push('L1强利空全市场自动置顶='+isAutoFlash(autoMsg)+' L2不自动='+isAutoFlash(normalMsg));
  /* 取消置顶统一走 togglePin（页面唯一入口）；需先入 NEWS，与真实页面一致 */
  NEWS.push(autoMsg); NEWS.push(normalMsg);
  togglePin('x1');
  out.push('取消自动置顶后='+(!isPinned(autoMsg))+' 手动置顶L2='+(togglePin('x2'),isPinned(normalMsg))+' 取消手动='+(togglePin('x2'),!isPinned(normalMsg)));
  NEWS.pop(); NEWS.pop();
  // 场景6：快照消息时间解析（YYYY-MM-DD HH:mm）
  var t=parseMsgTime({time:'2026-08-21 23:25'});
  out.push('时间解析='+(t instanceof Date && !isNaN(t))+' 当日消息活跃='+isActive({time:'2026-08-21 10:00'}));
  NEWS.pop(); NEWS.pop();
  // 场景7：多源标题去重（"重复的不要更新"）
  out.push('normTitle去重相同='+(normTitle('美股三大指数收高 道指涨近1%')===normTitle('美股三大指数收高，道指涨近1%'))+' 去重不同='+(normTitle('美股三大指数收高')!==normTitle('现货黄金涨1.88%')));
  // 场景8：财经日历条目结构 + 未来性硬断言
  /* 2026-09-24：日历从「硬编码宏观事件 + 快讯回填」改成「东财真实除权除息排期」。
     本场景此前只 push 进 out（信息性），现在同时写 __MSG_FAIL__ 参与闸门——
     否则日历空掉/全挤在同一天/把过去日期当未来事件，都会静默上线。 */
  var calA=buildCalAuto();
  var calBad=[];
  calA.forEach(function(c){
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(c.date||'')) calBad.push(c.id+':日期非法('+c.date+')');
    if((c.date||'')<TODAY_STR) calBad.push(c.id+':事件日期在过去');
    if(!c.key) calBad.push(c.id+':key=false 会被渲染成自定义事件（带删除按钮）');
    if(c.tag==='分红'&&!/每 10 股派/.test(c.preview||'')) calBad.push(c.id+':分红条目缺派息额');
  });
  if(calA.length>6){
    var uniqDay={}; calA.forEach(function(c){uniqDay[c.date]=1;});
    if(Object.keys(uniqDay).length<=1) calBad.push('日历 '+calA.length+' 条全部落在同一天（每日名额分摊失效）');
  }
  window.__MSG_FAIL__=calBad;
  out.push('自动日历条数='+calA.length+' 覆盖天数='+Object.keys(calA.reduce(function(a,c){a[c.date]=1;return a;},{})).length+' 含LPR='+calA.some(c=>c.name.indexOf('LPR')>=0)+' 含FOMC='+calA.some(c=>c.name.indexOf('FOMC')>=0)+' 每条含文案='+calA.every(c=>((c.detail||c.preview||c.result||'')+'').length>0)+' 硬断言失败='+calBad.length+(calBad.length?' → '+calBad.slice(0,3).join(' | '):''));
  window.__MSG_TESTS__=out;
})();
`;

/* ===== 静态契约检查（专治"错了不报错、死了不被发现"的静默失败）=====
   1) DOM 契约：脚本中以字面量调用的 getElementById('x')，其 id 必须在初始 HTML 中存在
      （仅查纯字面量，动态拼接如 `price-${key}` 不会命中，避免误报）
   2) 死函数：顶层 function 定义若全脚本只出现一次（只有定义、无人调用）则报出
      —— 顶栏搜索框 setupSearch() 曾长期是死的，而此前校验轮轮 PASS */
const contractIssues = [];
const DYNAMIC_IDS = new Set([
  // 由 JS 写入 innerHTML 后再取用的 id，静态 HTML 中不存在，属正常
]);
{
  const htmlIds = new Set();
  { const re = /id="([^"]+)"/g; let m; while ((m = re.exec(html))) htmlIds.add(m[1]); }
  const getRe = /getElementById\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g;
  const missing = new Set();
  let m2;
  while ((m2 = getRe.exec(script))) if (!htmlIds.has(m2[1]) && !DYNAMIC_IDS.has(m2[1])) missing.add(m2[1]);
  if (missing.size) contractIssues.push("DOM 契约破裂：getElementById 引用了初始 HTML 中不存在的 id → " + [...missing].join(", ") + "（改 id 后漏改脚本？）");

  const fnNames = [...new Set([...script.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((x) => x[1]))];
  const dead = fnNames.filter((n) => (script.match(new RegExp("\\b" + n + "\\b", "g")) || []).length <= 1);
  if (dead.length) contractIssues.push("死函数（已定义但全脚本无调用）→ " + dead.join(", "));
}

let threw = null;
try { eval(script + TEST_TAIL); } catch (e) { threw = e; }
if (threw) { console.log("THREW:", threw.message); console.log(threw.stack.split("\n").slice(0,4).join("\n")); process.exit(1); }

let gridAll = "";
const gridIds = [];
for (const g of ["cn","us","gold","watch"]) {
  if (store["grid-" + g]) { gridAll += store["grid-" + g].innerHTML; gridIds.push(g); }
}
const meta = store["meta"] ? (store["meta"].innerHTML || store["meta"].textContent) : "";
const bad = (gridAll.match(/NaN|Infinity|指标计算异常|数据加载失败/g) || []);
const cards = (gridAll.match(/class="card(\s|")/g) || []).length;
const ids = (gridAll.match(/id="c-[^"]+"/g) || []);
const reviewHTML = store["review-panel"] ? store["review-panel"].innerHTML : "";
const modCount = (reviewHTML.match(/rv-mod-head/g) || []).length;
/* 数值泄漏扫描：NaN/Infinity/异常 之外还必须查 null。
   2026-09-24：复盘"板块宽度"曾渲染成「窄（上涨板块 null%）」并连续 9 天通过校验——
   旧扫描只认 undefined/NaN，不认 null（且 `null >= 60`、`null >= 40` 均为 false，
   静默落进"窄"分支，全程不抛错）。
   这里按「值位置」判定：null/undefined/NaN 后面紧跟 % / 中文 / 收尾标点 / 标签结束才算泄漏，
   避免误伤正文里偶然出现的英文单词。 */
const LEAK = /(?:null|undefined|NaN)(?=[%\u4e00-\u9fa5）)，、。；：]|<\/|$)/;
const leaks = [];
{
  const probe = (s, what) => {
    const m = s.match(LEAK);
    if (!m) return;
    const at = m.index;
    leaks.push(what + " → …" + s.slice(Math.max(0, at - 26), at + 10).replace(/\s+/g, " ") + "…");
  };
  probe(reviewHTML, "复盘面板数值泄漏");
  probe(gridAll, "行情面板数值泄漏");
}
const reviewOK = modCount === 10 && reviewHTML.includes("涨停梯队") && reviewHTML.includes("后市展望") && !/undefined|NaN|null/.test(reviewHTML);
console.log("meta:", meta);
console.log("panels filled:", gridIds.join(","));
console.log("card divs:", cards);
console.log("card ids:", ids.join(", "));
console.log("review panel:", reviewOK ? "OK (10模块)" : "MISSING/不完整 (mod="+modCount+")");
console.log("bad tokens (NaN/Infinity/异常):", bad.length ? bad : "NONE");
console.log("数值泄漏 (null/undefined/NaN):", leaks.length ? leaks : "NONE");
console.log("contract:", contractIssues.length ? contractIssues.join(" | ") : "OK");
/* 退出码即闸门：CI 不再用 `|| echo` 吞掉失败——校验不过就不部署（宁停更，不部署坏产物）
   2026-09-24：此前 reviewOK 只打印、不参与判定，复盘面板坏掉照常上线。现一并纳入闸门。
   2026-09-24 补充：页面内单元测试（TEST_TAIL）里的日历硬断言也改为进闸门（__MSG_FAIL__）。 */
const msgFail = global.window.__MSG_FAIL__ || [];
const failed = bad.length > 0 || contractIssues.length > 0 || leaks.length > 0 || !reviewOK || msgFail.length > 0;
console.log("日历硬断言:", msgFail.length ? msgFail.join(" | ") : "PASS");
console.log(failed ? "FAIL" : "PASS");
console.log("MSG-TESTS:", (global.window.__MSG_TESTS__ || []).join(" | "));
process.exit(failed ? 1 : 0);
