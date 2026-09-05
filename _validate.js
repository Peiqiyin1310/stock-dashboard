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
global.window = {};
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
  var autoMsg={id:'x1',auto:true,level:'L1',dir:'强利空',assets:['全市场']};
  var normalMsg={id:'x2',auto:true,level:'L2',dir:'利多',assets:['大A']};
  out.push('L1强利空全市场自动置顶='+isAutoFlash(autoMsg)+' L2不自动='+isAutoFlash(normalMsg));
  unpinAuto('x1');
  out.push('取消自动置顶后='+(!isPinned(autoMsg))+' 手动置顶L2='+(togglePin('x2'),isPinned(normalMsg))+' 取消手动='+(togglePin('x2'),!isPinned(normalMsg)));
  // 场景6：快照消息时间解析（YYYY-MM-DD HH:mm）
  var t=parseMsgTime({time:'2026-08-21 23:25'});
  out.push('时间解析='+(t instanceof Date && !isNaN(t))+' 当日消息活跃='+isActive({time:'2026-08-21 10:00'}));
  NEWS.pop(); NEWS.pop();
  // 场景7：多源标题去重（"重复的不要更新"）
  out.push('normTitle去重相同='+(normTitle('美股三大指数收高 道指涨近1%')===normTitle('美股三大指数收高，道指涨近1%'))+' 去重不同='+(normTitle('美股三大指数收高')!==normTitle('现货黄金涨1.88%')));
  // 场景8：自动财经日历（LPR/FOMC/非农等）生成正常且每条含解读
  var calA=buildCalAuto();
  out.push('自动日历条数='+calA.length+' 含LPR='+calA.some(c=>c.name.indexOf('LPR')>=0)+' 含FOMC='+calA.some(c=>c.name.indexOf('FOMC')>=0)+' 每条含解读='+calA.every(c=>(c.detail||'').length>10));
  window.__MSG_TESTS__=out;
})();
`;

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
const reviewOK = modCount === 10 && reviewHTML.includes("涨停梯队") && reviewHTML.includes("后市展望") && !/undefined|NaN/.test(reviewHTML);
console.log("meta:", meta);
console.log("panels filled:", gridIds.join(","));
console.log("card divs:", cards);
console.log("card ids:", ids.join(", "));
console.log("review panel:", reviewOK ? "OK (10模块)" : "MISSING/不完整 (mod="+modCount+")");
console.log("bad tokens (NaN/Infinity/异常):", bad.length ? bad : "NONE");
console.log(bad.length ? "FAIL" : "PASS");
console.log("MSG-TESTS:", (global.window.__MSG_TESTS__ || []).join(" | "));
