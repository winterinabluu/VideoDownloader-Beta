# Weibo Video Parser Design

## Overview

Implement a Weibo (微博) video parser that extracts multi-quality MP4 download URLs from Weibo posts via the desktop AJAX API. Supports public videos via automatic visitor cookie flow, and restricted content via user-provided `WEIBO_COOKIE`.

## URL Formats & ID Extraction

| URL Format | ID Type | Extraction |
|---|---|---|
| `weibo.com/{uid}/{bid}` | bid (alphanumeric) | Last path segment |
| `m.weibo.cn/status/{mid}` | mid (numeric) | Last path segment |
| `m.weibo.cn/detail/{mid}` | mid (numeric) | Last path segment |
| `weibo.com/tv/show/{fid}` | fid (`1034:xxx`) | Path segment, then TV component API to resolve mid |
| `video.weibo.com/show?fid=xxx` | fid (query param) | Same as above |
| `t.cn/xxx` | — | Follow 302 redirect, then re-parse |

Regex for standard posts:
```
/(?:weibo\.com\/\d+|m\.weibo\.cn\/(?:status|detail))\/([a-zA-Z0-9]+)/
```

Regex for TV/video URLs:
```
/(?:weibo\.com\/tv\/show|video\.weibo\.com\/show).*?(?:\/|fid=)(\d+:[a-f0-9]+|\d+:\d+)/
```

## API Endpoints

### Primary: Statuses Show

```
GET https://weibo.com/ajax/statuses/show?id={bid_or_mid}
Headers:
  Referer: https://weibo.com/
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36
  Cookie: {WEIBO_COOKIE or visitor cookies}
```

Returns full post JSON with video data at `page_info.media_info`.

### TV Component API (for tv/show and video.weibo.com URLs only)

```
POST https://weibo.com/tv/api/component?page=/tv/show/{fid}
Content-Type: application/x-www-form-urlencoded
Body: data={"Component_Play_Playinfo":{"oid":"{fid}"}}
```

Returns `data.Component_Play_Playinfo` containing `mid`, which is then used with the primary API.

## Visitor Cookie Flow

Triggered when the API response redirects to `passport.weibo.com` (no user cookie configured).

### Step 1: Generate visitor token

```
POST https://passport.weibo.com/visitor/genvisitor
Content-Type: application/x-www-form-urlencoded
Body: cb=gen_callback&fp={"os":"1","browser":"Chrome125,0,0,0","fonts":"undefined","screenInfo":"1920*1080*24","plugins":""}
```

Response is JSONP. Strip callback wrapper to get `{ data: { tid, new_tid, confidence } }`.

### Step 2: Incarnate visitor

```
GET https://passport.weibo.com/visitor/visitor?a=incarnate&t={tid}&w={w}&c={confidence:03d}&gc=&cb=cross_domain&from=weibo&_rand={random}
```

Where `w=3` if `new_tid` is true, else `w=2`.

Response sets `SUB` and `SUBP` cookies. Extract from `Set-Cookie` headers or JSONP response body (`data.sub`, `data.subp`).

### Step 3: Retry original API request with cookies

## Video Format Extraction

### Primary: playback_list

Path: `response.page_info.media_info.playback_list[]`

Each entry has `play_info`:
- `url`: Direct MP4 URL
- `quality_desc`: Human-readable label (e.g., "720p")
- `label`: Machine label (e.g., "mp4_720p")
- `mime`: "video/mp4"
- `bitrate`: Bitrate in bps
- `width`, `height`: Resolution
- `size`: File size in bytes
- `video_codecs`, `audio_codecs`: Codec strings

### Fallback: flat URL keys in media_info

When `playback_list` is absent, check these keys on `media_info` directly:

| Key | Quality |
|---|---|
| `mp4_720p_mp4` | 720p |
| `mp4_hd_url` | HD (720p/1080p) |
| `mp4_sd_url` | SD (480p) |
| `stream_url_hd` | HD |
| `stream_url` | Default/SD |
| `h265_mp4_hd` | H.265 HD |
| `h265_mp4_ld` | H.265 LD |

Extract quality from URL `label=` and `template=` query parameters.

### Quality label mapping

| API label | Display label |
|---|---|
| `mp4_ld` | 360p |
| `mp4_sd` | 480p |
| `mp4_720p` | 720p |
| `mp4_hd` | 720p |
| `mp4_1080p` | 1080p |
| `hevc_mp4_hd` | 1080p (H.265) |

## Metadata Extraction

| Field | Source | Fallback |
|---|---|---|
| title | `page_info.media_info.video_title` | `text_raw` truncated to 80 chars |
| author | `user.screen_name` | — |
| coverUrl | `page_info.page_pic` | — |
| duration | `page_info.media_info.duration` | — |

## Download Integration

Weibo videos are muxed MP4 (audio+video combined). No ffmpeg merge needed. Uses existing `proxyDownload` path.

Add to `PLATFORM_DOWNLOAD_HEADERS` in `parse.ts`:
```typescript
weibo: { Referer: "https://weibo.com/" }
```

## Error Handling

| Condition | Error Code |
|---|---|
| Redirect to passport.weibo.com | Auto-trigger visitor cookie flow |
| HTTP 404 | `VIDEO_NOT_FOUND` |
| Post exists but no video | `VIDEO_NOT_FOUND` |
| Login required (HTTP 403 / specific JSON) | `LOGIN_REQUIRED` |
| Rate limited (HTTP 418/429) | `RATE_LIMITED` |
| API response parse failure | `PARSE_FAILED` |

## Out of Scope

- Multi-video posts (`mix_media_info`) — can be added later
- Live streams / live replay (HLS/m3u8)
- Frontend changes (existing UI auto-adapts to new platforms)
- User profile / batch download

## Files to Modify

1. `packages/server/src/platforms/weibo.ts` — Main implementation
2. `packages/server/src/routes/parse.ts` — Add Weibo download headers
3. `docs/platform-research.md` — Update Weibo section with implementation details
