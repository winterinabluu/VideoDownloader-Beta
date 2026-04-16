# 平台解析调研文档

本文档记录各平台的视频解析策略、限制条件和实现状态。开发者应在修改对应平台解析器前先阅读本文档。

## 状态总览

| 平台 | 实现状态 | 无水印支持 | 是否需要 Cookie | 备注 |
|------|---------|-----------|----------------|------|
| Twitter / X | ✅ 已实现 | 本身无水印 | 推荐（guest token 不稳定）| GraphQL API + 多码率 MP4 |
| 小红书 | ✅ 已实现 | ✅ 支持 | 不需要 | 从页面 SSR 数据提取 originVideoKey |
| Bilibili | ⏳ 预留 | 无水印 | 高清需要 | 推荐使用 API + ffmpeg 合并 |
| YouTube | ⏳ 预留 | 无水印 | 部分视频需要 | 建议集成 yt-dlp |
| 微博 | ⏳ 预留 | 可能 | 可能需要 | 需要进一步调研 |
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

## 微博（待实现）

### 建议策略

1. 处理短链 `t.cn` 跳转
2. 从微博正文页提取视频页 ID
3. 调用 `weibo.com/tv/api/component` 获取播放地址
4. 解析多清晰度 HLS/MP4 stream

### 限制

- 部分视频限制登录后观看
- 移动端 `m.weibo.cn` 和桌面端 `weibo.com` 结构不同

---

## 抖音（待实现）

### 建议策略

1. 短链 `v.douyin.com` 跟随 302 获得 aweme_id
2. 调用 `www.douyin.com/aweme/v1/web/aweme/detail/` 接口
3. 从 `video.play_addr.url_list` 拿到播放地址
4. 替换 `playwm` → `play` 即为无水印版本

### 限制

- 对 User-Agent 敏感（建议使用移动端 UA）
- 需要特定 Referer
- 部分接口需要签名参数（_signature）
- 抖音反爬策略更新频繁

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
