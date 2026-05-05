# 平台解析调研文档

本文档记录各平台的视频解析策略、限制条件和实现状态。开发者应在修改对应平台解析器前先阅读本文档。

## 状态总览

| 平台 | 实现状态 | 无水印支持 | 是否需要 Cookie | 备注 |
|------|---------|-----------|----------------|------|
| Twitter / X | ✅ 已实现 | 本身无水印 | 推荐（guest token 不稳定）| GraphQL API + 多码率 MP4 |
| 小红书 | ✅ 已实现 | ✅ 支持 | 不需要 | 从页面 SSR 数据提取 originVideoKey |
| Bilibili | ⏳ 预留 | 无水印 | 高清需要 | 推荐使用 API + ffmpeg 合并 |
| YouTube | ⏳ 预留 | 无水印 | 部分视频需要 | 建议集成 yt-dlp |
| 微博 | ✅ 已实现 | unknown | 公开视频自动 visitor cookie；受限内容需要 | AJAX API + 多清晰度 MP4 |
| 抖音 | ⏳ 预留 | 可做 | 移动端 UA 可能需要 | 有无水印资源 |

---

## Twitter / X

### 解析策略

1. 从 URL 提取 tweet ID（路径中的 `/status/{id}`）
2. 调用 GraphQL 端点 `TweetResultByRestId`
3. 从响应的 `extended_entities.media[*].video_info.variants[]` 提取视频
4. 过滤 `content_type === "video/mp4"` 并按 `bitrate` 降序排列

### 认证方式

实现了两条路径：

**a) Cookie 认证（推荐）**
- 需要 `auth_token` + `ct0` Cookie
- 从浏览器开发者工具复制
- 设置到环境变量 `TWITTER_COOKIE`
- 更稳定，不会被限流

**b) Guest Token（备用）**
- 向 `/1.1/guest/activate.json` 请求获取 guest_token
- 使用静态 bearer token（Web 客户端使用的）
- **2025 年后已被严格限制**：绑定浏览器指纹 + IP，数据中心 IP 基本不可用

### 典型码率

| 码率 | 分辨率 |
|------|--------|
| 2176 kbps | 720p |
| 832 kbps | 360p |
| 320 kbps | 180p |

### 已知问题

- 视频 URL 带 JWT 签名，有效期 3-5 分钟 → 必须服务端实时获取再代理
- GraphQL 的 `doc_id` 会随时间变化，需要定期更新
- NSFW 或受限内容需要登录 Cookie

---

## 小红书

### 解析策略

1. 如果是 `xhslink.com` 短链，跟随 302 跳转获得完整 URL
2. 从 URL 路径提取 note ID（`/explore/{id}` 或 `/discovery/item/{id}`）
3. 请求 `https://www.xiaohongshu.com/explore/{noteId}` 获取 HTML
4. 从 HTML 中提取 `window.__INITIAL_STATE__` JSON
5. 从 JSON 中读取 `note.video.consumer.originVideoKey`
6. 拼接 CDN 地址 `https://sns-video-bd.xhscdn.com/{originVideoKey}`

### 无水印原理

- 页面 SSR 数据里的 `originVideoKey` 指向原始视频文件（无水印）
- `<meta property="og:video">` 指向的是带水印的分享版本
- 长按保存/官方下载按钮得到的也是带水印版本

### 水印区分

| URL 类型 | 路径特征 | 水印状态 |
|---------|---------|---------|
| 有水印 | `_259.mp4` 后缀 | 有用户名 + 平台水印 |
| 无水印 | 通过 originVideoKey 拼接 | 无任何水印 |

### 请求头要求

```
User-Agent: Mozilla/5.0 ... Chrome/125.0.0.0
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
Referer: https://www.xiaohongshu.com/
```

Cookie 不是必需的，但某些内容（例如登录可见）可能需要。

### 已知问题

- 页面结构可能变化，需要多个 fallback 提取逻辑
- 个别视频可能 `originVideoKey` 缺失，需要回退到 `og:video`
- CDN 域名偶尔变化（`sns-video-bd` / `sns-video-hw`）

---

## Bilibili（待实现）

### 建议策略

1. 从 BV/av 号获取 cid（Part ID）
2. 调用 `api.bilibili.com/x/player/playurl` 获取 playurl
3. 高清 DASH 流需要 Cookie（SESSDATA）
4. 音视频分离时需要 ffmpeg 合并

### 限制

- 免登录：最高 480p
- 登录：最高 1080p
- 大会员：最高 4K + HDR
- 部分视频有地区限制

---

## YouTube（待实现）

### 建议策略

强烈推荐集成 `yt-dlp`：
- 处理 YouTube 签名解密（客户端 JS 代码经常变化）
- 支持所有视频类型（普通/Shorts/直播回放）
- 自动选择最高清晰度
- 与 ffmpeg 配合音视频合并

### 限制

- 地区限制视频
- 年龄限制视频需要 Cookie
- 私有视频不可解析
- 部分 2023 年后的 YT 反爬策略需要频繁更新 yt-dlp

---

## 微博

### 实现状态：✅ 已实现

### 解析策略

1. 处理短链 `t.cn` → 跟随 302 跳转获得完整 URL
2. 从 URL 提取 bid/mid（标准帖子）或 fid（tv/show 页）
3. fid 类型 URL 通过 `weibo.com/tv/api/component` 解析为 mid
4. 调用 `weibo.com/ajax/statuses/show?id={id}` 获取帖子详情
5. 从 `page_info.media_info.playback_list` 提取多清晰度 MP4 URL
6. Fallback: 从 `media_info` 的扁平字段（`mp4_hd_url`, `stream_url` 等）提取

### 认证方式

**a) Visitor Cookie（默认，公开视频）**
- 自动向 `passport.weibo.com/visitor/genvisitor` 请求临时访客凭证
- 获取 `SUB` + `SUBP` Cookie，缓存 10 分钟
- 无需用户配置，适用于所有公开视频

**b) 用户 Cookie（受限内容）**
- 通过 `WEIBO_COOKIE` 环境变量配置
- 需要 `SUB` Cookie（从浏览器开发者工具复制）
- 可访问仅粉丝可见等受限内容

### 支持的 URL 格式

| 格式 | 示例 |
|------|------|
| 桌面正文页 | `weibo.com/7827771738/N4xlMvjhI` |
| 移动端 status | `m.weibo.cn/status/4189191225395228` |
| 移动端 detail | `m.weibo.cn/detail/4189191225395228` |
| TV 视频页 | `weibo.com/tv/show/1034:4797699866951785` |
| video 子域 | `video.weibo.com/show?fid=1034:xxx` |
| 短链 | `t.cn/xxxxx` |

### 典型清晰度

| label | 分辨率 |
|-------|--------|
| mp4_ld | 360p |
| mp4_sd | 480p |
| mp4_720p | 720p |
| mp4_1080p | 1080p |

### 请求头要求

```
Referer: https://weibo.com/
User-Agent: Chrome UA
Cookie: SUB=xxx; SUBP=yyy （visitor 自动获取或用户配置）
```

### 已知限制

- 部分仅粉丝可见视频需要登录 Cookie
- 不支持多视频帖子中的逐个提取（取首个视频）
- 不支持直播/直播回放（HLS m3u8 格式）
- Visitor cookie 流程可能因微博反爬更新而失效

---

## 抖音（已实现 — yt-dlp 集成）

### 实现方式

采用 yt-dlp 集成方案（与 YouTube 共用 `ytdlp.ts` 共享模块），避免直接对接抖音反爬接口。

1. yt-dlp `--dump-json` 获取视频元数据和下载 URL
2. 筛选 `protocol=https` 的 muxed MP4 格式
3. 按分辨率去重，保留最高码率
4. yt-dlp 自动处理无水印版本

### 支持的 URL 格式

- `v.douyin.com/*` — 短链接（最常见的分享格式）
- `www.douyin.com/video/*` — 标准视频链接

### Cookie 配置

通过 `DOUYIN_COOKIE` 环境变量配置，用于需要登录才能访问的内容。

### 依赖

- yt-dlp 必须已安装（`YTDLP_PATH` 在 `.env` 中配置）

### 限制

- 依赖 yt-dlp 社区维护抖音适配，yt-dlp 版本需保持更新
- 抖音反爬策略更新频繁，yt-dlp 可能偶尔滞后

---

## 通用注意事项

### 安全

- 所有解析器在请求前必须经过 `validateUrl()` 校验
- 禁止访问内网地址段（10.x / 172.16.x / 192.168.x / 127.x / 169.254.x / localhost）

### 隐私

- Cookie 仅通过环境变量注入，绝不写死
- 日志中不能输出 Cookie 内容
- 错误消息不要暴露内部堆栈

### 开发流程

1. 新平台：在 `platforms/` 创建新文件，实现 `PlatformParser` 接口
2. 在 `registry.ts` 中注册
3. 添加单元测试到 `tests/detectPlatform.test.ts`
4. 更新本文档
