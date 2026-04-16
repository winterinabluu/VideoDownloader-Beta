import type { VideoParseResult } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const XHS_HOST_PATTERNS = [
  /^(?:www\.)?xiaohongshu\.com$/i,
  /^xhslink\.com$/i,
];

const NOTE_ID_PATTERN = /\/(?:explore|discovery\/item)\/([a-f0-9]+)/i;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const VIDEO_CDN_HOSTS = [
  "https://sns-video-bd.xhscdn.com/",
  "https://sns-video-hw.xhscdn.com/",
];

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

    // Step 1: Follow short link redirects
    let finalUrl = url;
    const u = new URL(url);

    if (u.hostname === "xhslink.com") {
      finalUrl = await followRedirect(url, cookie);
    }

    // Step 2: Extract note ID and preserve query params (xsec_token etc.)
    const parsedUrl = new URL(finalUrl);
    const noteIdMatch = parsedUrl.pathname.match(NOTE_ID_PATTERN);
    if (!noteIdMatch) {
      throw new AppError(ErrorCodes.INVALID_URL, "Cannot extract note ID from URL", {
        detail: finalUrl,
      });
    }
    const noteId = noteIdMatch[1];

    // Step 3: Fetch the page HTML with cookies and original query params
    // xsec_token is bound to the user's session, must be forwarded
    const pageUrl = new URL(`https://www.xiaohongshu.com/explore/${noteId}`);
    const xsecToken = parsedUrl.searchParams.get("xsec_token");
    const xsecSource = parsedUrl.searchParams.get("xsec_source");
    if (xsecToken) pageUrl.searchParams.set("xsec_token", xsecToken);
    if (xsecSource) pageUrl.searchParams.set("xsec_source", xsecSource);

    const headers: Record<string, string> = {
      "User-Agent": DEFAULT_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://www.xiaohongshu.com/",
      Cookie: cookie,
    };

    const resp = await fetch(pageUrl.toString(), { headers, redirect: "follow" });

    // Check if redirected to 404/security page
    const responseUrl = resp.url;
    if (responseUrl.includes("/404") || responseUrl.includes("sec_")) {
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
 */
async function followRedirect(url: string, cookie: string): Promise<string> {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": DEFAULT_UA,
      Cookie: cookie,
    },
  });
  return resp.url;
}

/**
 * Extract video info from the page HTML.
 * The page contains server-rendered JSON with video data.
 */
function extractVideoFromHtml(
  html: string,
  noteId: string,
  sourceUrl: string,
): VideoParseResult {
  // Try to extract __INITIAL_STATE__ JSON
  const stateMatch = html.match(
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?})\s*<\/script>/,
  );

  let title: string | undefined;
  let author: string | undefined;
  let coverUrl: string | undefined;
  let videoUrl: string | undefined;

  if (stateMatch) {
    try {
      // The JSON may contain unicode-escaped characters and JS-specific tokens
      const jsonStr = stateMatch[1]
        .replace(/undefined/g, "null")
        .replace(/\\u002F/g, "/");
      const state = JSON.parse(jsonStr);

      // Navigate the state structure - try multiple paths
      const noteDetailMap = state?.note?.noteDetailMap;
      let note: any = null;

      if (noteDetailMap) {
        // Try exact noteId first, then iterate all keys
        const detail = noteDetailMap[noteId];
        if (detail?.note) {
          note = detail.note;
        } else {
          // Sometimes the key format differs, check all entries
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

      // Alternative path in state
      if (!note && state?.noteData?.note) {
        note = state.noteData.note;
      }

      if (note) {
        title = note.title || note.desc;
        author = note.user?.nickname || note.user?.name;
        coverUrl =
          note.imageList?.[0]?.urlDefault ??
          note.imageList?.[0]?.url;

        // Extract video key for watermark-free URL — try multiple paths
        const originVideoKey =
          note.video?.consumer?.originVideoKey ??
          note.video?.media?.stream?.h264?.[0]?.masterUrl ??
          note.video?.media?.stream?.h265?.[0]?.masterUrl;

        if (originVideoKey) {
          if (originVideoKey.startsWith("http")) {
            videoUrl = originVideoKey;
          } else {
            videoUrl = VIDEO_CDN_HOSTS[0] + originVideoKey;
          }
        }

        // Try additional video URL paths
        if (!videoUrl) {
          const videoAddr =
            note.video?.url ??
            note.video?.firstFrameUrl ??
            note.video?.media?.videoPlayInfo?.url;
          if (videoAddr && videoAddr.startsWith("http")) {
            videoUrl = videoAddr;
          }
        }
      }
    } catch {
      // JSON parse failed, fall through to regex extraction
    }
  }

  // Fallback: extract originVideoKey via regex from raw HTML
  if (!videoUrl) {
    const keyMatch = html.match(/"originVideoKey"\s*:\s*"([^"]+)"/);
    if (keyMatch) {
      const key = keyMatch[1].replace(/\\u002F/g, "/");
      videoUrl = VIDEO_CDN_HOSTS[0] + key;
    }
  }

  // Fallback: look for video URL patterns in HTML
  if (!videoUrl) {
    const cdnMatch = html.match(
      /https?:\/\/sns-video-[a-z]+\.xhscdn\.com\/[^\s"'<]+\.mp4[^\s"'<]*/,
    );
    if (cdnMatch) {
      videoUrl = cdnMatch[0];
    }
  }

  // Another fallback: og:video meta tag (this one typically has watermark)
  let ogVideoUrl: string | undefined;
  const ogMatch = html.match(
    /<meta\s+property="og:video"\s+content="([^"]+)"/i,
  );
  if (ogMatch) {
    ogVideoUrl = ogMatch[1].replace(/&amp;/g, "&");
  }

  if (!title) {
    const titleMatch = html.match(
      /<meta\s+(?:property="og:title"|name="title")\s+content="([^"]+)"/i,
    );
    title = titleMatch?.[1];
  }

  if (!author) {
    const authorMatch = html.match(
      /<meta\s+name="author"\s+content="([^"]+)"/i,
    );
    author = authorMatch?.[1];
  }

  if (!coverUrl) {
    const coverMatch = html.match(
      /<meta\s+property="og:image"\s+content="([^"]+)"/i,
    );
    coverUrl = coverMatch?.[1];
  }

  // Determine final video situation
  if (!videoUrl && !ogVideoUrl) {
    throw new AppError(
      ErrorCodes.VIDEO_NOT_FOUND,
      "This note does not contain a video, or the video could not be extracted. Make sure the link is a video note (not an image note) and your cookies are valid.",
    );
  }

  const videos: VideoParseResult["videos"] = [];

  if (videoUrl) {
    videos.push({
      qualityLabel: "Original (no watermark)",
      format: "mp4",
      hasAudio: true,
      hasVideo: true,
      url: videoUrl,
      isWatermarked: false,
    });
  }

  if (ogVideoUrl && ogVideoUrl !== videoUrl) {
    videos.push({
      qualityLabel: "Standard (watermarked)",
      format: "mp4",
      hasAudio: true,
      hasVideo: true,
      url: ogVideoUrl,
      isWatermarked: true,
    });
  }

  return {
    platform: "xiaohongshu",
    sourceUrl,
    title,
    author,
    coverUrl,
    watermarkStatus: videoUrl ? "no_watermark" : "watermarked",
    videos,
  };
}
