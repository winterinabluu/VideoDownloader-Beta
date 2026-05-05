# Video Downloader

网页端视频链接解析与下载工具，粘贴链接即可解析并下载视频。

## 🎯 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| **Twitter / X** | ✅ 已完成 | GraphQL API 解析，需配置 Cookie |
| **小红书** | ✅ 已完成 | 无水印下载，多编码格式（H.264/H.265/AV1） |
| **Bilibili** | ✅ 已完成 | DASH 模式，支持 4K~360p 多清晰度，ffmpeg 音视频合并 |
| **YouTube** | ✅ 已完成 | 基于 yt-dlp，DASH 分轨 + 自动配对最佳音频 |
| **微博** | ✅ 已完成 | AJAX API，访客 Cookie 自动获取，多清晰度 MP4 |
| **抖音** | ✅ 已完成 | 基于 yt-dlp，无水印下载，多清晰度 |

## ✨ 特性

- 🔗 自动识别平台，粘贴链接即解析
- 🎞️ 支持多清晰度选择，DASH 分轨自动合并
- 💧 小红书无水印下载
- 🎬 ffmpeg 实时合并音视频流（Bilibili / YouTube DASH 内容）
- 📱 响应式布局，PC / 手机浏览器通用
- 🧩 模块化解析器架构，方便扩展新平台
- 🛡️ 内置 SSRF 防护、限流、下载 token 过期机制

## 📦 技术栈

- **前端**：React 18 + Vite + Tailwind CSS + TypeScript
- **后端**：Hono + Node.js + TypeScript
- **测试**：Vitest
- **包管理**：pnpm workspace（monorepo）

## 📁 项目结构

```
packages/
├── shared/            # 共享类型 + 工具
│   └── src/
│       ├── types/video.ts       # 视频解析类型定义、API 契约
│       └── utils/url.ts         # URL 校验、SSRF 防护、文件名处理
├── server/            # 后端 API（Hono + Node.js）
│   └── src/
│       ├── platforms/           # 平台解析器（核心）
│       │   ├── base.ts          #   PlatformParser 接口
│       │   ├── registry.ts      #   解析器注册 + 平台检测
│       │   ├── twitter.ts       #   Twitter/X 解析
│       │   ├── xiaohongshu.ts   #   小红书解析
│       │   ├── bilibili.ts      #   Bilibili 解析
│       │   ├── youtube.ts       #   YouTube 解析（yt-dlp）
│       │   ├── weibo.ts         #   微博解析
│       │   ├── douyin.ts        #   抖音解析（yt-dlp）
│       │   └── ytdlp.ts         #   yt-dlp 共享运行器
│       ├── routes/              # parse / download / health
│       ├── services/            # 下载代理 + token store + ffmpeg 合并
│       └── middleware/          # 限流 + 错误处理
└── web/               # 前端（React + Vite + Tailwind）
    └── src/
        ├── components/          # LinkInput / VideoInfo / QualitySelector 等
        ├── hooks/               # useVideoParser 状态管理
        └── utils/               # API 客户端 + 下载逻辑
docs/
└── platform-research.md         # 平台解析原理调研
```

## 🚀 本地开发

### 1. 环境要求

- Node.js 18+
- pnpm 9+（`npm i -g pnpm`）
- ffmpeg — 音视频合并（Bilibili / YouTube DASH 内容需要）
- yt-dlp — YouTube 支持

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cd packages/server
cp .env.example .env
# 按需填入 Cookie（Twitter 推荐配置 TWITTER_COOKIE 以提高稳定性）
```

### 4. 启动开发服务器

```bash
# 同时启动前后端
pnpm dev

# 或分别启动
pnpm dev:server   # http://localhost:3000
pnpm dev:web      # http://localhost:5173
```

前端会自动代理 `/api/*` 请求到后端。

### 5. 运行测试

```bash
pnpm test
```

## 🔧 配置说明

参见 `packages/server/.env.example`：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 后端端口 | 3000 |
| `FRONTEND_URL` | 前端来源（CORS）| http://localhost:5173 |
| `TWITTER_COOKIE` | Twitter 登录 Cookie（强烈推荐）| - |
| `XIAOHONGSHU_COOKIE` | 小红书 Cookie | - |
| `BILIBILI_COOKIE` | B 站 SESSDATA（高清需要登录）| - |
| `YOUTUBE_COOKIES` | YouTube Netscape Cookies 文件路径 | - |
| `WEIBO_COOKIE` | 微博 Cookie（受限内容需要）| - |
| `DOUYIN_COOKIE` | 抖音 Cookie（受限内容需要）| - |
| `FFMPEG_PATH` | ffmpeg 可执行文件路径 | ffmpeg |
| `YTDLP_PATH` | yt-dlp 可执行文件路径 | yt-dlp |
| `DOWNLOAD_CACHE_TTL_SECONDS` | 下载 token 过期秒数 | 600 |
| `MAX_DOWNLOAD_SIZE_MB` | 单文件最大下载大小 | 2048 |

### Twitter Cookie 获取步骤

1. 在浏览器登录 twitter.com / x.com
2. 打开开发者工具 → Network 标签
3. 刷新页面，找到任意请求 → 复制请求头中的完整 `Cookie` 值
4. 粘贴到 `.env` 中的 `TWITTER_COOKIE=...`

## 🌐 API 文档

### `POST /api/parse`

解析视频链接。

**请求体：**
```json
{ "url": "https://x.com/user/status/1234567890" }
```

**成功响应：**
```json
{
  "ok": true,
  "data": {
    "platform": "twitter",
    "sourceUrl": "...",
    "title": "...",
    "author": "@username",
    "coverUrl": "...",
    "duration": 30,
    "watermarkStatus": "no_watermark",
    "videos": [
      {
        "qualityLabel": "720p",
        "format": "mp4",
        "url": "/api/download?token=...",
        "bitrate": 2176000,
        "hasAudio": true,
        "hasVideo": true
      }
    ]
  }
}
```

### `GET /api/download?token=xxx`

凭 token 下载视频，返回 `Content-Type: video/mp4` 的附件。

### `GET /api/health`

健康检查。

## 🚢 部署

### Docker 部署（待补充）

计划提供 Dockerfile 一键部署，ffmpeg / yt-dlp 会一并打包。

### 手动部署

**后端：**
```bash
pnpm --filter @vd/server build
cd packages/server
NODE_ENV=production node dist/index.js
```

**前端：**
```bash
pnpm --filter @vd/web build
# 构建产物在 packages/web/dist/，可部署到 Cloudflare Pages / GitHub Pages
```

需要在部署前端时配置 API 的完整 URL（修改 `utils/api.ts` 的 `API_BASE`）。

## ⚠️ 使用须知

- **仅供个人使用**：请尊重原创作者的版权
- **不绕过付费/私密/DRM**：只解析公开可访问的内容
- **平台可能变化**：解析规则会失效，欢迎 PR 更新

## 📚 延伸阅读

- [docs/platform-research.md](docs/platform-research.md) — 各平台解析原理与限制

## 📄 许可

仅供学习研究使用。
