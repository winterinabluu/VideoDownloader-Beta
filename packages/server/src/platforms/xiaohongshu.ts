import type { VideoParseResult, VideoVariant } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const XHS_HOST_PATTERNS = [
  /^(?:www\.)?xiaohongshu\.com$/i,
  /^xhslink\.com$/i,
];

const NOTE_ID_PATTERN = /\/(?:explore|discovery\/item)\/([a-f0-9]+)/i;

// Mobile UA is required — the desktop UA triggers a redirect to the 404 / security
// page on xiaohongshu.com/discovery/item/*. The H5 (mobile) site is what the
// share-link flow is built for, and it embeds the stream URLs we need.
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

export const xiaohongshuParser: PlatformParser = {
  name: "xiaohongshu",
  label: "小红书",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return XHS_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, config: AppConfig): Promise<VideoParseResult> {
    const cookie = config.cookies.xiaohongshu;
    if (!cookie) {
      throw new AppError(
        ErrorCodes.LOGIN_REQUIRED,
        "Xiaohongshu requires browser cookies to access notes. Please set XIAOHONGSHU_COOKIE in your .env file. See README for instructions.",
      );
    }

    // Step 1: Follow short-link redirects without cookies — we only want the final
    // URL with a fresh xsec_token. The redirect chain sets no cookies of its own.
    let finalUrl = url;
    const u = new URL(url);

    if (u.hostname === "xhslink.com") {
      finalUrl = await followRedirect(url);
    }

    // Step 2: Pull the note ID out of the resolved URL.
    const parsedUrl = new URL(finalUrl);
    const noteIdMatch = parsedUrl.pathname.match(NOTE_ID_PATTERN);
    if (!noteIdMatch) {
      throw new AppError(ErrorCodes.INVALID_URL, "Cannot extract note ID from URL", {
        detail: finalUrl,
      });
    }
    const noteId = noteIdMatch[1];

    // Step 3: Fetch the mobile H5 page with cookies + the share's xsec params.
    const pageUrl = new URL(finalUrl);

    const headers: Record<string, string> = {
      "User-Agent": MOBILE_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://www.xiaohongshu.com/",
      Cookie: cookie,
    };

    const resp = await fetch(pageUrl.toString(), { headers, redirect: "follow" });

    const responseUrl = resp.url;
    const responsePath = (() => {
      try {
        return new URL(responseUrl).pathname;
      } catch {
        return "";
      }
    })();
    if (
      responsePath.includes("/404") ||
      /\/sec[-_]check/i.test(responsePath) ||
      /\/verify/i.test(responsePath)
    ) {
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        "Xiaohongshu blocked the request. This usually means the cookie has expired or the xsec_token is invalid. Please refresh your browser cookies.",
        { detail: `Redirected to: ${responseUrl}` },
      );
    }

    if (!resp.ok) {
      throw new AppError(ErrorCodes.PARSE_FAILED, `Failed to fetch page: ${resp.status}`, {
        detail: pageUrl.toString(),
      });
    }

    const html = await resp.text();
    return extractVideoFromHtml(html, noteId, url);
  },
};

/**
 * Follow redirect to get the final URL from short links.
 * No cookies — we just need the 302 chain and its fresh xsec_token.
 */
async function followRedirect(url: string): Promise<string> {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": MOBILE_UA },
  });
  return resp.url;
}

interface XhsStreamEntry {
  masterUrl?: string;
  backupUrls?: string[];
  width?: number;
  height?: number;
  videoBitrate?: number;
  avgBitrate?: number;
  size?: number;
  format?: string;
  qualityType?: string;
  streamType?: number;
  videoCodec?: string;
}

function extractVideoFromHtml(
  html: string,
  noteId: string,
  sourceUrl: string,
): VideoParseResult {
  const stateMatch = html.match(
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?})\s*<\/script>/,
  );

  let title: string | undefined;
  let author: string | undefined;
  let coverUrl: string | undefined;
  let duration: number | undefined;
  const variants: VideoVariant[] = [];

  if (stateMatch) {
    try {
      // The embedded JSON uses JS `undefined` tokens which are invalid JSON.
      const jsonStr = stateMatch[1].replace(/:\s*undefined\b/g, ":null");
      const state = JSON.parse(jsonStr);

      // Mobile H5 layout (current): state.noteData.data.noteData
      let note: any = state?.noteData?.data?.noteData;

      // Desktop SSR layout (legacy): state.note.noteDetailMap[noteId].note
      if (!note) {
        const noteDetailMap = state?.note?.noteDetailMap;
        if (noteDetailMap) {
          const detail = noteDetailMap[noteId];
          if (detail?.note) {
            note = detail.note;
          } else {
            for (const key of Object.keys(noteDetailMap)) {
              if (key === "null" || key === "undefined") continue;
              const entry = noteDetailMap[key];
              if (entry?.note?.type === "video" || entry?.note?.video) {
                note = entry.note;
                break;
              }
            }
          }
        }
      }

      if (note) {
        title = note.title || note.desc;
        author =
          note.user?.nickName ||
          note.user?.nickname ||
          note.user?.name ||
          note.user?.userNickname;

        coverUrl =
          note.cover?.urlDefault ??
          note.cover?.url ??
          note.imageList?.[0]?.urlDefault ??
          note.imageList?.[0]?.url;

        duration =
          note.video?.capa?.duration ??
          note.video?.media?.video?.duration;

        const stream = note.video?.media?.stream;
        if (stream && typeof stream === "object") {
          // h264 first (broadest compatibility), then h265 for smaller file.
          const order: Array<keyof typeof stream> = [
            "h264",
            "h265",
            "h266",
            "av1",
          ];
          for (const codec of order) {
            const arr = stream[codec] as XhsStreamEntry[] | undefined;
            if (!Array.isArray(arr)) continue;
            for (const entry of arr) {
              const u = pickStreamUrl(entry);
              if (!u) continue;
              variants.push({
                qualityLabel: buildQualityLabel(codec as string, entry),
                format: (entry.format as any) || "mp4",
                url: u,
                width: entry.width,
                height: entry.height,
                bitrate: entry.videoBitrate ?? entry.avgBitrate,
                size: entry.size,
                hasVideo: true,
                hasAudio: true,
                isWatermarked: false,
              });
            }
          }
        }

        // Legacy originVideoKey path — only used when the new stream path is empty.
        if (variants.length === 0) {
          const legacyKey = note.video?.consumer?.originVideoKey;
          if (typeof legacyKey === "string" && legacyKey.length > 0) {
            const legacyUrl = legacyKey.startsWith("http")
              ? legacyKey
              : "https://sns-video-bd.xhscdn.com/" + legacyKey;
            variants.push({
              qualityLabel: "Original",
              format: "mp4",
              url: legacyUrl,
              hasVideo: true,
              hasAudio: true,
              isWatermarked: false,
            });
          }
        }
      }
    } catch {
      // Fall through to regex-based fallbacks.
    }
  }

  // Fallback: pull any CDN mp4 URL out of the raw HTML.
  if (variants.length === 0) {
    const cdnMatch = html.match(
      /https?:\/\/sns-video-[a-z0-9]+\.xhscdn\.com\/[^\s"'<\\]+\.mp4[^\s"'<\\]*/,
    );
    if (cdnMatch) {
      variants.push({
        qualityLabel: "Default",
        format: "mp4",
        url: cdnMatch[0],
        hasVideo: true,
        hasAudio: true,
        isWatermarked: false,
      });
    }
  }

  // Meta-tag fallback for title/cover if JSON extraction missed them.
  if (!title) {
    const titleMatch = html.match(
      /<meta\s+(?:property="og:title"|name="title")\s+content="([^"]+)"/i,
    );
    title = titleMatch?.[1];
  }
  if (!author) {
    const authorMatch = html.match(/<meta\s+name="author"\s+content="([^"]+)"/i);
    author = authorMatch?.[1];
  }
  if (!coverUrl) {
    const coverMatch = html.match(
      /<meta\s+property="og:image"\s+content="([^"]+)"/i,
    );
    coverUrl = coverMatch?.[1];
  }

  // og:video is the watermarked share-preview URL — include as last-resort only.
  if (variants.length === 0) {
    const ogMatch = html.match(
      /<meta\s+property="og:video"\s+content="([^"]+)"/i,
    );
    if (ogMatch) {
      variants.push({
        qualityLabel: "Standard (watermarked)",
        format: "mp4",
        url: ogMatch[1].replace(/&amp;/g, "&"),
        hasVideo: true,
        hasAudio: true,
        isWatermarked: true,
      });
    }
  }

  if (variants.length === 0) {
    throw new AppError(
      ErrorCodes.VIDEO_NOT_FOUND,
      "This note does not contain a video, or the video could not be extracted. Make sure the link is a video note (not an image note) and your cookies are valid.",
    );
  }

  // Sort by bitrate desc so the highest quality is presented first.
  variants.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  const anyClean = variants.some((v) => !v.isWatermarked);
  const watermarkStatus: VideoParseResult["watermarkStatus"] = anyClean
    ? "no_watermark"
    : "watermarked";

  return {
    platform: "xiaohongshu",
    sourceUrl,
    title,
    author,
    coverUrl,
    duration,
    watermarkStatus,
    videos: variants,
  };
}

function pickStreamUrl(entry: XhsStreamEntry): string | undefined {
  const candidates = [entry.masterUrl, ...(entry.backupUrls ?? [])];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      // Prefer https where the server offers it.
      return c.startsWith("http://") ? c.replace(/^http:/, "https:") : c;
    }
  }
  return undefined;
}

function buildQualityLabel(codec: string, entry: XhsStreamEntry): string {
  const codecLabel = codec.toUpperCase();
  const res =
    entry.height && entry.width
      ? `${Math.min(entry.width, entry.height)}p`
      : entry.qualityType || "";
  return [res, codecLabel].filter(Boolean).join(" · ");
}
