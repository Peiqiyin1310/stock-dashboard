/*
 * 旧链接实时代理服务（多资源 + 多上游 + 失败退避版）
 * 作用：旧网址背后转发 GitHub 上的最新看板（GitHub Actions 每 10 分钟更新）。
 * 资源：
 *   /              → index.html（页面本体）
 *   /news.json     → 快讯快照（页面同源 fetch 兜底通道；此前 404 导致兜底失效）
 *   /calendar.json → 财经日历（此前 404 导致日历结果不自动更新）
 * 每个资源的上游依次尝试：
 *   1. GitHub Pages（最实时；沙箱被墙时快速失败并退避）
 *   2. api.github.com contents（仓库最新提交，无 CDN 缓存）
 *   3. jsDelivr CDN（沙箱可达；配合 CI 提交回仓库 + purge 保持新鲜）
 * 兜底：启动用目录内文件做种子；成功内容落盘 last_good-*；上游全失败返回最后一次成功内容，绝不白屏。
 * 诊断：GET /status 返回各上游实时连通性、退避状态与缓存信息。
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const TTL = 60000;            // 缓存 60 秒（stale-while-revalidate）
const BACKOFF = 10 * 60000;   // 某上游失败后 10 分钟内跳过（/status 仍实时探测）
const REPO = "Peiqiyin1310/stock-dashboard";

/* 路由表：url path → 仓库内文件名 + Content-Type + 落盘兜底文件 */
const RESOURCES = {
  "/":               { file: "index.html",     ct: "text/html; charset=utf-8",        seed: path.join(__dirname, "last_good.html"), minSize: 1000 },
  "/news.json":      { file: "news.json",      ct: "application/json; charset=utf-8", seed: path.join(__dirname, "last_good-news.json"), minSize: 50 },
  "/calendar.json":  { file: "calendar.json",  ct: "application/json; charset=utf-8", seed: path.join(__dirname, "last_good-calendar.json"), minSize: 50 },
};

/* 每个资源的上游列表（按 file 参数化） */
function upstreamsFor(file) {
  return [
    { name: "github-pages", host: "peiqiyin1310.github.io", upath: "/stock-dashboard/" + file, parse: (b) => b },
    {
      name: "api-github",
      host: "api.github.com",
      upath: "/repos/" + REPO + "/contents/stock-dashboard/" + file + "?ref=main",
      parse: (b) => {
        const j = JSON.parse(b.toString("utf8"));
        if (!j.content || j.encoding !== "base64") throw new Error("unexpected api response");
        return Buffer.from(j.content.replace(/\n/g, ""), "base64");
      },
    },
    { name: "jsdelivr", host: "cdn.jsdelivr.net", upath: "/gh/" + REPO + "@main/stock-dashboard/" + file, parse: (b) => b },
  ];
}

const UPSTREAMS = upstreamsFor("index.html");   // /status 用主资源探测
const caches = {};        // path → { body:Buffer, t:number, src:string }
const refreshing = {};    // path → bool
const failedUntil = {};   // `${path}|${upstream}` → ts
const lastProbe = {};     // /status 展示最近一次真实探测

/* 启动种子：last_good-* → 目录内同名文件（index.html） */
(function seed() {
  for (const [p, r] of Object.entries(RESOURCES)) {
    const candidates = [r.seed, path.join(__dirname, r.file)];
    for (const f of candidates) {
      try {
        if (fs.existsSync(f)) {
          const b = fs.readFileSync(f);
          if (b.length > r.minSize) {
            caches[p] = { body: b, t: Date.now(), src: "seed:" + path.basename(f) };
            console.log("seeded", p, "from", path.basename(f), b.length, "bytes");
            break;
          }
        }
      } catch (e) {}
    }
  }
})();

function getBuf(host, upath, cb) {
  const req = https.get(
    { host, path: upath, headers: { "User-Agent": "wb-dashboard-proxy", Accept: "*/*" }, timeout: 12000 },
    (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        const loc = new URL(r.headers.location, "https://" + host);
        return getBuf(loc.host, loc.pathname + (loc.search || ""), cb);
      }
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => cb(null, r.statusCode, Buffer.concat(chunks)));
    }
  );
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", (e) => cb(e));
}

function tryUpstreams(ups, key, i, minSize, cb, forced) {
  if (i >= ups.length) {
    /* 若整轮失败仅因"全部上游都在退避"，清空退避强制再试一轮：
       否则唯一健康的上游会因一次瞬时抖动被拉黑 10 分钟，期间一直 serve 旧缓存 */
    if (!forced) {
      let hadBackoff = false;
      for (const u of ups) {
        if (failedUntil[key + "|" + u.name]) { hadBackoff = true; delete failedUntil[key + "|" + u.name]; }
      }
      if (hadBackoff) return tryUpstreams(ups, key, 0, minSize, cb, true);
    }
    return cb(new Error("all upstreams failed"));
  }
  const u = ups[i];
  if (!forced && Date.now() < (failedUntil[key + "|" + u.name] || 0)) return tryUpstreams(ups, key, i + 1, minSize, cb, forced); // 退避中，跳过
  getBuf(u.host, u.upath, (err, status, buf) => {
    let out = null;
    if (!err && status >= 200 && status < 300 && buf && buf.length > minSize) {
      try { out = u.parse(buf); } catch (e) { err = e; }
    }
    if (out && out.length > minSize) {
      lastProbe[key + "|" + u.name] = "ok " + out.length + "B @" + new Date().toISOString();
      delete failedUntil[key + "|" + u.name];
      return cb(null, out, u.name);
    }
    const why = err ? err.message : "HTTP " + status;
    lastProbe[key + "|" + u.name] = "fail " + why + " @" + new Date().toISOString();
    failedUntil[key + "|" + u.name] = Date.now() + BACKOFF;
    tryUpstreams(ups, key, i + 1, minSize, cb);
  });
}

function refreshResource(p, done) {
  const r = RESOURCES[p];
  if (!r) return done && done(new Error("unknown resource"));
  if (refreshing[p]) return done && done();
  refreshing[p] = true;
  tryUpstreams(upstreamsFor(r.file), p, 0, r.minSize, (err, buf, src) => {
    refreshing[p] = false;
    if (!err && buf) {
      caches[p] = { body: buf, t: Date.now(), src: "up:" + src };
      try { fs.writeFileSync(r.seed, buf); } catch (e) {}
    }
    done && done(err);
  });
}

function serveCache(res, p) {
  const c = caches[p];
  res.writeHead(200, { "Content-Type": RESOURCES[p].ct, "Cache-Control": "no-store" });
  res.end(c ? c.body : "");
}

const server = http.createServer((req, res) => {
  const p = (req.url || "/").split("?")[0] || "/";

  if (p === "/status") {
    let left = UPSTREAMS.length;
    const now = Date.now();
    UPSTREAMS.forEach((u) => {
      getBuf(u.host, u.upath, (err, status, buf) => {
        let msg;
        if (!err && status >= 200 && status < 300 && buf && buf.length > 1000) {
          try { msg = "ok " + u.parse(buf).length + "B"; } catch (e) { msg = "fail parse " + e.message; }
        } else {
          msg = "fail " + (err ? err.message : "HTTP " + status);
        }
        lastProbe["/|" + u.name] = msg + " @" + new Date().toISOString();
        if (--left === 0) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({
            version: "2026-09-11b",   // 用于确认沙箱实际加载的是哪版（此前无法区分新旧）
            upstreams: lastProbe,
            backoff: Object.keys(failedUntil).map((k) => ({ name: k, skipUntil: new Date(failedUntil[k]).toISOString() })),
            cache: Object.fromEntries(Object.entries(RESOURCES).map(([rp, r]) => {
              const c = caches[rp];
              return [rp, c ? { bytes: c.body.length, ageMs: now - c.t, src: c.src } : null];
            })),
          }, null, 1));
        }
      });
    });
    return;
  }

  if (!RESOURCES[p]) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }

  const c = caches[p];
  const fresh = c && Date.now() - c.t < TTL;
  if (fresh) {
    serveCache(res, p);
    refreshResource(p);
  } else {
    refreshResource(p, () => {
      if (caches[p]) serveCache(res, p);
      else {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("upstream unavailable, try later");
      }
    });
  }
});

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("dashboard proxy listening on", process.env.PORT || 3000);
});
