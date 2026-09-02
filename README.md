# 股市观测工作台 · 云端自动刷新版

个人股票财经看板：行情（大A/港股/美股/黄金）+ 7x24 财经快讯 + 关键事件日历 + 每日盘后复盘。

**完全云端运行**：所有数据抓取与构建由 GitHub Actions 每 10 分钟自动执行，产物发布到 GitHub Pages，不依赖任何本地客户端在线。

## 访问地址

`https://<你的GitHub用户名>.github.io/<仓库名>/`

## 工作原理

```
GitHub Actions (cron 每10分钟)
  ├─ node _gen.js          行情：腾讯行情+天天基金净值+新浪外汇 → data.json.symbols/fx
  ├─ node _gen_news.js     快讯：新浪7x24 + 财联社 + 东财 → data.json.news / news.json
  ├─ node _gen_calendar.js 日历：抓多源快讯，按关键词回填关键事件真实结果 → calendar.json
  ├─ node _gen_review.js   复盘：盘后(北京≥15:05)自动用东财公开接口抓当日盘后数据
  ├─ node _build.js        把 data.json 内嵌进 index.html
  └─ node _validate.js     校验（无 NaN / 26标的 / 10模块复盘）
        ↓
官方 Pages action（upload-pages-artifact + deploy-pages）→ GitHub Pages 自动发布
```

前端页面内还会**实时直连**腾讯行情 JSONP（30秒~5分钟）+ 三源快讯 JSONP（60秒）+ 后台快照兜底，打开即最新。

## 目录结构

| 文件 | 作用 |
|---|---|
| `_gen.js` | 行情快照（43 个标的 + 汇率） |
| `_gen_news.js` | 多源快讯聚合（新浪/财联社/东财） |
| `_gen_calendar.js` | 财经日历关键事件结果回填 |
| `_gen_review.js` | 每日复盘生成（云端模式自动抓东财公开数据） |
| `_fetch_review_cloud.js` | 东财公开接口抓取模块（替代本地 MCP，供云端用） |
| `_build.js` | 构建 index.html |
| `_validate.js` | 校验 |
| `stock-dashboard/` | 站点文件（index.html 构建产物 / data.json / news.json / calendar.json） |
| `.github/workflows/refresh.yml` | 每 10 分钟自动刷新工作流 |

## 首次部署（只需一次）

1. 把本目录推送到 GitHub 公开仓库（公开仓库 Actions 无限分钟）。
2. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**（保存后无需再选分支，workflow 会自动部署）。
3. 打开 `https://<用户名>.github.io/<仓库名>/` 即可。之后每 10 分钟自动刷新，无需任何操作。

## 数据说明

- **红涨绿跌**（A股惯例）。
- 信号 = 技术信号（均线/MACD/RSI/KDJ/布林）+ 消息修正（L1官方×1 / L2权威×0.5，L3仅浏览）。
- 复盘数据源：工作日盘后自动抓取东方财富公开接口（涨跌家数/成交额/板块/涨停梯队/龙虎榜/主力资金流），无公开源字段（如估值分位）沿用最近值或显示"待补"，绝不编造。
- 非投资建议，市场有风险。

## 手动触发

仓库 Actions 页 → **Auto Refresh Dashboard** → Run workflow，可立即手动刷新一次。
