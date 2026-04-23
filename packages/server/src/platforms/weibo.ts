import type { VideoParseResult, VideoVariant, VideoFormat } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const WEIBO_HOST_PATTERNS = [
  /^(?:www\.)?weibo\.com$/i,
  /^m\.weibo\.cn$/i,
  /^weibo\.cn$/i,
  /^video\.weibo\.com$/i,
  /^t\.cn$/i,
];

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const WEIBO_REFERER = "https://weibo.com/";

const STATUSES_SHOW_API = "https://weibo.com/ajax/statuses/show";
const TV_COMPONENT_API = "https://weibo.com/tv/api/component";
const VISITOR_GEN_URL = "https://passport.weibo.com/visitor/genvisitor";
const VISITOR_INCARNATE_URL =
  "https://passport.weibo.com/visitor/visitor";

// ── URL pattern regexes ─────────────────────────────────────────────

/** weibo.com/{uid}/{bid} or m.weibo.cn/status/{mid} or m.weibo.cn/detail/{mid} */
const STANDARD_POST_PATTERN =
  /(?:weibo\.com\/\d+|m\.weibo\.cn\/(?:status|detail))\/([a-zA-Z0-9]+)/;

/** weibo.com/tv/show/{fid} */
const TV_SHOW_PATH_PATTERN = /weibo\.com\/tv\/show\/(\d+:[a-f0-9]+|\d+:\d+)/i;

/** video.weibo.com/show?fid=xxx */
const VIDEO_SHOW_FID_PATTERN =
  /video\.weibo\.com\/show\?.*?fid=(\d+:[a-f0-9]+|\d+:\d+)/i;

// ── Quality label mapping ───────────────────────────────────────────

const QUALITY_LABELS: Record<string, string> = {
  mp4_ld: "360p",
  mp4_sd: "480p",
  mp4_720p: "720p",
  mp4_hd: "720p",
  mp4_1080p: "1080p",
  hevc_mp4_hd: "1080p (H.265)",
  hevc_mp4_ld: "360p (H.265)",
  h265_mp4_hd: "1080p (H.265)",
  h265_mp4_ld: "360p (H.265)",
};

/** Order for sorting: higher = better quality */
const QUALITY_ORDER: Record<string, number> = {
  mp4_ld: 1,
  hevc_mp4_ld: 1,
  h265_mp4_ld: 1,
  mp4_sd: 2,
  mp4_720p: 3,
  mp4_hd: 3,
  mp4_1080p: 4,
  hevc_mp4_hd: 4,
  h265_mp4_hd: 4,
};

// ── Weibo API response types ────────────────────────────────────────

interface PlayInfo {
  url: string;
  quality_desc?: string;
  label?: string;
  mime?: string;
  bitrate?: number;
  video_codecs?: string;
  audio_codecs?: string;
  width?: number;
  height?: number;
  size?: number;
  fps?: number;
}

interface PlaybackListItem {
  play_info: PlayInfo;
}

interface MediaInfo {
  playback_list?: PlaybackListItem[];
  video_title?: string;
  kol_title?: string;
  name?: string;
  duration?: number;
  // Flat URL fallback fields
  stream_url?: string;
  stream_url_hd?: string;
  mp4_sd_url?: string;
  mp4_hd_url?: string;
  mp4_720p_mp4?: string;
  h265_mp4_hd?: string;
  h265_mp4_ld?: string;
  [key: string]: unknown;
}

interface PageInfo {
  media_info?: MediaInfo;
  page_pic?: string;
}

interface WeiboUser {
  screen_name?: string;
  id?: number;
}

interface WeiboStatusResponse {
  id?: number;
  mid?: string;
  mblogid?: string;
  text_raw?: string;
  page_info?: PageInfo;
  user?: WeiboUser;
}

interface VisitorTokenResponse {
  data: {
    tid: string;
    new_tid: boolean;
    confidence: number;
  };
}

interface TvComponentResponse {
  data?: {
    Component_Play_Playinfo?: {
      mid?: string;
      [key: string]: unknown;
    };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Referer: WEIBO_REFERER,
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

/**
 * Follow redirect chain for t.cn short links.
 */
async function followRedirect(url: string): Promise<string> {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": DEFAULT_UA },
  });
  return resp.url;
}

/**
 * Parse JSONP response by stripping the callback wrapper.
 * E.g. `gen_callback({"data":{...}})` → `{"data":{...}}`
 */
function parseJsonp(text: string): unknown {
  const match = text.match(/\w+\(({[\s\S]+})\)/);
  if (!match) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      "Failed to parse JSONP response from Weibo passport",
    );
  }
  return JSON.parse(match[1]);
}

/**
 * Generate visitor cookies for unauthenticated access.
 * Returns a cookie string like "SUB=xxx; SUBP=yyy".
 */
async function generateVisitorCookies(): Promise<string> {
  // Step 1: Generate visitor token
  const fp = JSON.stringify({
    os: "1",
    browser: "Chrome125,0,0,0",
    fonts: "undefined",
    screenInfo: "1920*1080*24",
    plugins: "",
  });

  const genResp = await fetch(VISITOR_GEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": DEFAULT_UA,
    },
    body: `cb=gen_callback&fp=${encodeURIComponent(fp)}`,
  });

  if (!genResp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Visitor token generation failed: HTTP ${genResp.status}`,
    );
  }

  const genText = await genResp.text();
  const genData = parseJsonp(genText) as VisitorTokenResponse;
  const { tid, new_tid, confidence } = genData.data;

  // Step 2: Incarnate visitor to get cookies
  const w = new_tid ? 3 : 2;
  const c = String(confidence).padStart(3, "0");
  const rand = Math.random().toFixed(16);
  const incarnateUrl =
    `${VISITOR_INCARNATE_URL}?a=incarnate&t=${encodeURIComponent(tid)}&w=${w}&c=${c}&gc=&cb=cross_domain&from=weibo&_rand=${rand}`;

  const incResp = await fetch(incarnateUrl, {
    headers: { "User-Agent": DEFAULT_UA },
  });

  if (!incResp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Visitor incarnation failed: HTTP ${incResp.status}`,
    );
  }

  // Try extracting from JSONP response body
  const incText = await incResp.text();
  const incData = parseJsonp(incText) as {
    data?: { sub?: string; subp?: string };
  };

  const sub = incData.data?.sub;
  const subp = incData.data?.subp;

  if (sub && subp) {
    return `SUB=${sub}; SUBP=${subp}`;
  }

  // Fallback: extract from Set-Cookie headers
  const setCookies = incResp.headers.getSetCookie?.() ?? [];
  const cookieParts: string[] = [];
  for (const sc of setCookies) {
    const m = sc.match(/^(SUB|SUBP)=([^;]+)/);
    if (m) cookieParts.push(`${m[1]}=${m[2]}`);
  }

  if (cookieParts.length > 0) {
    return cookieParts.join("; ");
  }

  throw new AppError(
    ErrorCodes.PARSE_FAILED,
    "Failed to obtain visitor cookies from Weibo passport",
  );
}

// Cached visitor cookies (short-lived, regenerated on failure)
let visitorCookieCache: { cookie: string; expiresAt: number } | null = null;
const VISITOR_COOKIE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getVisitorCookies(): Promise<string> {
  if (visitorCookieCache && Date.now() < visitorCookieCache.expiresAt) {
    return visitorCookieCache.cookie;
  }

  const cookie = await generateVisitorCookies();
  visitorCookieCache = {
    cookie,
    expiresAt: Date.now() + VISITOR_COOKIE_TTL_MS,
  };
  return cookie;
}

function invalidateVisitorCookies(): void {
  visitorCookieCache = null;
}

/**
 * Fetch JSON from Weibo API with automatic visitor cookie handling.
 * If the response redirects to passport.weibo.com, triggers visitor flow and retries.
 */
async function weiboFetchJson<T>(
  url: string,
  userCookie?: string,
): Promise<T> {
  const cookie = userCookie || (await getVisitorCookies());

  const resp = await fetch(url, {
    headers: buildHeaders(cookie),
    redirect: "manual",
  });

  // Check for passport redirect (302 to passport.weibo.com)
  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location") ?? "";
    if (location.includes("passport.weibo.com")) {
      if (userCookie) {
        throw new AppError(
          ErrorCodes.LOGIN_REQUIRED,
          "Your Weibo cookie appears to be expired. Please update WEIBO_COOKIE.",
        );
      }
      // Regenerate visitor cookies and retry
      invalidateVisitorCookies();
      const freshCookie = await getVisitorCookies();
      const retryResp = await fetch(url, {
        headers: buildHeaders(freshCookie),
      });
      if (!retryResp.ok) {
        throw new AppError(
          ErrorCodes.PARSE_FAILED,
          `Weibo API returned HTTP ${retryResp.status} after visitor cookie refresh`,
        );
      }
      return retryResp.json() as Promise<T>;
    }
  }

  if (resp.status === 404) {
    throw new AppError(
      ErrorCodes.VIDEO_NOT_FOUND,
      "Weibo post not found. It may have been deleted.",
    );
  }

  if (resp.status === 403) {
    throw new AppError(
      ErrorCodes.LOGIN_REQUIRED,
      "This Weibo content requires login. Set WEIBO_COOKIE environment variable.",
    );
  }

  if (resp.status === 418 || resp.status === 429) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      "Weibo rate limit triggered. Please wait a moment and try again.",
    );
  }

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Weibo API returned HTTP ${resp.status}`,
    );
  }

  return resp.json() as Promise<T>;
}

// ── ID extraction ───────────────────────────────────────────────────

interface WeiboVideoId {
  type: "post";
  id: string; // bid or mid
}

interface WeiboFid {
  type: "fid";
  fid: string; // e.g. "1034:4797699866951785"
}

type WeiboId = WeiboVideoId | WeiboFid;

function extractWeiboId(url: string): WeiboId {
  const urlStr = url;

  // Check TV show path: weibo.com/tv/show/{fid}
  const tvMatch = urlStr.match(TV_SHOW_PATH_PATTERN);
  if (tvMatch) {
    return { type: "fid", fid: tvMatch[1] };
  }

  // Check video.weibo.com/show?fid=xxx
  const videoShowMatch = urlStr.match(VIDEO_SHOW_FID_PATTERN);
  if (videoShowMatch) {
    return { type: "fid", fid: videoShowMatch[1] };
  }

  // Standard post URL
  const postMatch = urlStr.match(STANDARD_POST_PATTERN);
  if (postMatch) {
    return { type: "post", id: postMatch[1] };
  }

  throw new AppError(
    ErrorCodes.INVALID_URL,
    "Cannot extract video ID from Weibo URL",
    {
      detail:
        "Supported formats: weibo.com/{uid}/{bid}, m.weibo.cn/status/{mid}, weibo.com/tv/show/{fid}",
    },
  );
}

/**
 * Resolve a fid (from tv/show URLs) to a post mid via the TV component API.
 */
async function resolveFidToMid(
  fid: string,
  cookie?: string,
): Promise<string> {
  const apiUrl = `${TV_COMPONENT_API}?page=/tv/show/${fid}`;
  const body = `data=${encodeURIComponent(JSON.stringify({ Component_Play_Playinfo: { oid: fid } }))}`;

  const ck = cookie || (await getVisitorCookies());
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      ...buildHeaders(ck),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Weibo TV component API returned HTTP ${resp.status}`,
    );
  }

  const json = (await resp.json()) as TvComponentResponse;
  const mid = json.data?.Component_Play_Playinfo?.mid;

  if (!mid) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      "Failed to resolve TV show fid to post mid",
      { detail: fid },
    );
  }

  return mid;
}

// ── Format extraction ───────────────────────────────────────────────

/** Fallback URL keys in media_info and their quality labels */
const FALLBACK_URL_KEYS: Array<{
  key: string;
  label: string;
  order: number;
}> = [
  { key: "mp4_720p_mp4", label: "720p", order: 3 },
  { key: "mp4_hd_url", label: "720p", order: 3 },
  { key: "mp4_sd_url", label: "480p", order: 2 },
  { key: "stream_url_hd", label: "HD", order: 3 },
  { key: "stream_url", label: "SD", order: 1 },
  { key: "h265_mp4_hd", label: "HD (H.265)", order: 3 },
  { key: "h265_mp4_ld", label: "LD (H.265)", order: 1 },
];

/**
 * Extract quality label from a video URL's `label` query parameter.
 * E.g. "...?label=mp4_720p&..." → "720p"
 */
function labelFromUrl(videoUrl: string): string | null {
  try {
    const u = new URL(videoUrl);
    const label = u.searchParams.get("label");
    if (label && QUALITY_LABELS[label]) {
      return QUALITY_LABELS[label];
    }
    return label ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract resolution from a video URL's `template` query parameter.
 * E.g. "...?template=1280x720&..." → { width: 1280, height: 720 }
 */
function resolutionFromUrl(
  videoUrl: string,
): { width: number; height: number } | null {
  try {
    const u = new URL(videoUrl);
    const template = u.searchParams.get("template");
    if (template) {
      const m = template.match(/^(\d+)x(\d+)$/);
      if (m) {
        return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractVariants(mediaInfo: MediaInfo): VideoVariant[] {
  const variants: VideoVariant[] = [];
  const seenUrls = new Set<string>();

  // Primary path: playback_list
  if (mediaInfo.playback_list && mediaInfo.playback_list.length > 0) {
    for (const item of mediaInfo.playback_list) {
      const pi = item.play_info;
      if (!pi?.url) continue;
      if (seenUrls.has(pi.url)) continue;
      seenUrls.add(pi.url);

      const label = pi.label ?? "";
      const qualityLabel =
        pi.quality_desc || QUALITY_LABELS[label] || labelFromUrl(pi.url) || label || "Unknown";

      variants.push({
        qualityLabel,
        width: pi.width,
        height: pi.height,
        bitrate: pi.bitrate,
        fps: pi.fps,
        format: "mp4" as VideoFormat,
        hasAudio: true,
        hasVideo: true,
        url: pi.url,
        size: pi.size,
      });
    }

    // Sort by bitrate/resolution descending
    variants.sort((a, b) => {
      const aOrder = QUALITY_ORDER[
        mediaInfo.playback_list!.find(
          (i) => i.play_info.url === a.url,
        )?.play_info.label ?? ""
      ] ?? 0;
      const bOrder = QUALITY_ORDER[
        mediaInfo.playback_list!.find(
          (i) => i.play_info.url === b.url,
        )?.play_info.label ?? ""
      ] ?? 0;
      if (bOrder !== aOrder) return bOrder - aOrder;
      return (b.bitrate ?? 0) - (a.bitrate ?? 0);
    });

    return variants;
  }

  // Fallback: flat URL keys in media_info
  for (const { key, label, order } of FALLBACK_URL_KEYS) {
    const url = mediaInfo[key];
    if (typeof url !== "string" || !url.startsWith("http")) continue;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const resolvedLabel = labelFromUrl(url) ?? label;
    const resolution = resolutionFromUrl(url);

    variants.push({
      qualityLabel: resolvedLabel,
      width: resolution?.width,
      height: resolution?.height,
      format: "mp4" as VideoFormat,
      hasAudio: true,
      hasVideo: true,
      url,
    });
  }

  // Sort by quality order
  variants.sort((a, b) => {
    const aEntry = FALLBACK_URL_KEYS.find((e) =>
      a.qualityLabel.includes(e.label),
    );
    const bEntry = FALLBACK_URL_KEYS.find((e) =>
      b.qualityLabel.includes(e.label),
    );
    return (bEntry?.order ?? 0) - (aEntry?.order ?? 0);
  });

  return variants;
}

// ── Parser ───────────────────────────────────────────────────────────

export const weiboParser: PlatformParser = {
  name: "weibo",
  label: "微博",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return WEIBO_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, config: AppConfig): Promise<VideoParseResult> {
    const userCookie = config.cookies.weibo;

    // Step 1: Resolve t.cn short links
    let resolvedUrl = url;
    try {
      const u = new URL(url);
      if (u.hostname === "t.cn") {
        resolvedUrl = await followRedirect(url);
        const resolved = new URL(resolvedUrl);
        if (!WEIBO_HOST_PATTERNS.some((p) => p.test(resolved.hostname))) {
          throw new AppError(
            ErrorCodes.INVALID_URL,
            "Short link did not resolve to a Weibo page",
            { detail: resolvedUrl },
          );
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        "Failed to resolve Weibo short link",
        { detail: url },
      );
    }

    // Step 2: Extract video ID
    const weiboId = extractWeiboId(resolvedUrl);

    // Step 3: Resolve fid → mid if needed
    let postId: string;
    if (weiboId.type === "fid") {
      postId = await resolveFidToMid(weiboId.fid, userCookie);
    } else {
      postId = weiboId.id;
    }

    // Step 4: Fetch post data via AJAX API
    const apiUrl = `${STATUSES_SHOW_API}?id=${encodeURIComponent(postId)}`;
    const data = await weiboFetchJson<WeiboStatusResponse>(apiUrl, userCookie);

    // Step 5: Validate the post has video
    const mediaInfo = data.page_info?.media_info;
    if (!mediaInfo) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "This Weibo post does not contain a video",
      );
    }

    // Step 6: Extract video variants
    const variants = extractVariants(mediaInfo);
    if (variants.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No downloadable video streams found in this Weibo post",
      );
    }

    // Step 7: Extract metadata
    const title =
      mediaInfo.video_title ||
      mediaInfo.kol_title ||
      mediaInfo.name ||
      (data.text_raw ? data.text_raw.slice(0, 80) : undefined);
    const author = data.user?.screen_name;
    const coverUrl = data.page_info?.page_pic;
    const duration = mediaInfo.duration;

    return {
      platform: "weibo",
      sourceUrl: url,
      title,
      author,
      coverUrl,
      duration,
      watermarkStatus: "unknown",
      videos: variants,
    };
  },
};
