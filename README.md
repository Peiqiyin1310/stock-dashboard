# 股市观测工作台 · 云端自动刷新版

个人股票财经看板：行情（大A/港股/美股/黄金）+ 7x24 财经快讯 + 关键事件日历 + 每日盘后复盘。

**完全云端运行**：数据抓取与构建由 GitHub Actions 自动执行，产物发布到 GitHub Pages。

## 访问地址

| 链接 | 说明 |
|---|---|
| https://peiqiyin1310.github.io/stock-dashboard/ | 主链接（GitHub Pages，随每轮构建自动发布） |
| https://d484ae9dc73c457e81ee7d108e46e027.app.workbuddy.link | 备用链接（沙箱跑 `stock-dashboard/server.js` 反代 + 60s SWR 缓存，上游全挂也不白屏）；`/status` 看各上游健康度 |

> ⚠️ 不要把本站点用「静态发布」的方式覆盖到反代目录——会把活的代理覆盖成冻结快照。

## 工作原理

```
GitHub Actions (cron 每10分钟，实际约 16~20 分钟一轮：GitHub 会对高频 schedule 节流)
  ├─ node _gen.js          行情：腾讯行情+天天基金净值+新浪外汇 → data.json.symbols/fx
  ├─ node _gen_news.js     快讯：新浪7x24 + 财联社 + 东财 → data.json.news / news.json
  ├─ node _gen_calendar.js 日历：抓多源快讯，按关键词回填关键事件真实结果 → calendar.json
  ├─ node _gen_review.js   复盘：盘后(北京≥15:05)自动用东财公开接口抓当日盘后数据
  ├─ node _build.js        把 data.json 内嵌进 index.html
  └─ node _validate.js     校验（数值泄漏 / DOM 契约 / 死函数 / 复盘 10 模块）
        ↓ 校验不过 → 退出码 1 → 不部署（宁停更，不部署坏产物）
提交回仓库 + 刷 jsDelivr CDN 缓存 → 官方 Pages action 发布
```

前端页面内还会**实时直连**腾讯行情 JSONP（30秒~5分钟）+ 快讯 JSONP（60秒）+ 后台快照兜底，打开即最新。

### 两个快讯通道的差别（重要）

- **前端浏览器直连**：新浪7x24 / 财联社 / 东财，三个都能通（用户在国内的正常网络下）。
- **后台 CI 抓取**：只有新浪7x24 与东财快讯两个源**实际有数据**。财联社接口在 GitHub Actions 的机房 IP 上不可达（本机实测可达、云端连续 8 个版本缺席），因此 `news.json` 里只有两源。
  页面底部展示的是后台快照，所以条数会少于浏览器直连时的合并结果——这是正常现象，不是抓取失败。

## 目录结构

| 文件 | 作用 |
|---|---|
| `_gen.js` | 行情快照（43 个标的 + 汇率） |
| `_gen_news.js` | 多源快讯聚合（新浪/财联社/东财） |
| `_gen_calendar.js` | 财经日历关键事件结果回填 |
| `_gen_review.js` | 每日复盘生成（云端模式自动抓东财公开数据） |
| `_fetch_review_cloud.js` | 东财公开接口抓取模块（替代本地 MCP，供云端用） |
| `_build.js` | 构建 index.html |
| `_validate.js` | 校验（同时是部署闸门） |
| `_sim.js` | 本地离线自检：把 `_check.js` 里的分析函数抽出来跑一遍，扫 NaN/Inf（需先构建过，否则 SKIP） |
| `review_snapshot.json` | 当日盘后复盘的抓取缓存（同一交易日内后续轮次直接复用，避免重复抓东财） |
| `stock-dashboard/` | 站点文件（`_template.html` 模板 / `index.html` 构建产物 / `data.json` / `news.json` / `calendar.json` / `server.js` 备用链接反代） |
| `.github/workflows/refresh.yml` | 自动刷新工作流 |

## 首次部署（只需一次）

1. 把本目录推送到 GitHub 公开仓库（公开仓库 Actions 无限分钟）。
2. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**（不要选 Deploy from a branch）。
3. 打开 Pages 链接即可。之后自动刷新，无需任何操作。

## 数据说明

- **红涨绿跌**（A股惯例）。
- 信号 = 技术信号（均线/MACD/RSI/KDJ/布林）+ 消息修正（L1官方×1 / L2权威×0.5，L3仅浏览）。
- 复盘数据源：工作日盘后自动抓取东方财富公开接口（涨跌家数/成交额/板块/涨停梯队/龙虎榜/主力资金流）、中证指数官网（估值 PE 与历史分位）、中债登（国债收益率曲线）。抓不到的字段沿用最近值或显示"待补"，绝不编造。
- 复盘"情绪阶段"是**固定规则判定**（涨停家数/炸板率/连板高度），不是 AI 实时判断。
- 估值模块的 PB / 股息率目前无公开源，字段留空。
- 非投资建议，市场有风险。

## 手动触发

仓库 Actions 页 → **Auto Refresh Dashboard** → Run workflow，可立即手动刷新一次。

## 本地排错

本机若 `git push` 因网络被墙失败，可改用 GitHub Contents API 逐文件 PUT（GET sha → PUT base64）；
注意每个文件一次 PUT 会各产生一个 commit，触发多个 CI run，前面的会被 `concurrency` 判 cancelled（正常）。
