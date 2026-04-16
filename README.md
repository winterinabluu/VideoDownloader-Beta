# Video Downloader

网页端视频链接解析与下载工具，支持从 Twitter/X、小红书、B 站、YouTube、微博、抖音等平台提取视频链接并下载。

## ✨ 特性

- 🔗 自动识别平台，粘贴链接即解析
- 🎞️ 支持多清晰度选择，优先最高画质 MP4
- 💧 小红书无水印下载
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
├── shared/          # 共享类型 + 工具
│   └── src/
│       ├── types/video.ts
│       └── utils/url.ts
├── server/          # 后端 API
│   └── src/
│       ├── platforms/   # 平台解析器（核心）
│       ├── routes/      # parse / download / health
│       ├── services/    # 下载代理 + token store
│       └── middleware/  # 限流 + 错误处理
└── web/             # 前端
    └── src/
        ├── components/
        ├── hooks/
        └── utils/
docs/
└── platform-research.md  # 平台调研
```

## 🚀 本地开发

### 1. 环境要求

- Node.js 18+
- pnpm 9+（`npm i -g pnpm`）
- 可选：ffmpeg（音视频合并）
- 可选：yt-dlp（YouTube 支持）

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
| `XIAOHONGSHU_COOKIE` | 小红书 Cookie（可选）| - |
| `BILIBILI_COOKIE` | B 站 SESSDATA（高清需要）| - |
| `YOUTUBE_COOKIES` | YouTube Cookies 文件路径 | - |
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

### Docker 部署（推荐，待补充）

项目会提供 Dockerfile 一键部署，届时 ffmpeg / yt-dlp 会一并打包。

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
- 需求文档：`G:\CodeX\OpenAIDefault\需求.md`（本地）

## 📄 许可

仅供学习研究使用。
