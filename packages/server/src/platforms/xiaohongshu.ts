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
    // Step 1: Follow short link redirects
    let finalUrl = url;
    const u = new URL(url);

    if (u.hostname === "xhslink.com") {
      finalUrl = await followRedirect(url);
    }

    // Step 2: Extract note ID
    const noteIdMatch = finalUrl.match(NOTE_ID_PATTERN);
    if (!noteIdMatch) {
      throw new AppError(ErrorCodes.INVALID_URL, "Cannot extract note ID from URL", {
        detail: finalUrl,
      });
    }
    const noteId = noteIdMatch[1];

    // Step 3: Fetch the page HTML and extract SSR data
    const pageUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
    const cookie = config.cookies.xiaohongshu;

    const headers: Record<string, string> = {
      "User-Agent": DEFAULT_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://www.xiaohongshu.com/",
    };
    if (cookie) {
      headers["Cookie"] = cookie;
    }

    const resp = await fetch(pageUrl, { headers, redirect: "follow" });
    if (!resp.ok) {
      throw new AppError(ErrorCodes.PARSE_FAILED, `Failed to fetch page: ${resp.status}`, {
        detail: pageUrl,
      });
    }

    const html = await resp.text();
    return extractVideoFromHtml(html, noteId, pageUrl);
  },
};

/**
 * Follow redirect to get the final URL from short links.
 */
async function followRedirect(url: string): Promise<string> {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": DEFAULT_UA,
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
    /window\.__INITIAL_STATE__\s*=\s*({.+?})\s*<\/script>/s,
  );

  let title: string | undefined;
  let author: string | undefined;
  let coverUrl: string | undefined;
  let videoUrl: string | undefined;

  if (stateMatch) {
    try {
      // The JSON may contain unicode-escaped characters
      const jsonStr = stateMatch[1]
        .replace(/undefined/g, "null")
        .replace(/\\u002F/g, "/");
      const state = JSON.parse(jsonStr);

      // Navigate the state structure
      const noteDetail =
        state?.note?.noteDetailMap?.[noteId] ??
        state?.note?.note;
      const note = noteDetail?.note ?? noteDetail;

      if (note) {
        title = note.title || note.desc;
        author = note.user?.nickname || note.user?.name;
        coverUrl = note.imageList?.[0]?.urlDefault;

        // Extract video key for watermark-free URL
        const originVideoKey =
          note.video?.consumer?.originVideoKey ??
          note.video?.media?.stream?.h264?.[0]?.masterUrl;

        if (originVideoKey) {
          // If it's already a full URL, use it directly
          if (originVideoKey.startsWith("http")) {
            videoUrl = originVideoKey;
          } else {
            videoUrl = VIDEO_CDN_HOSTS[0] + originVideoKey;
          }
        }
      }
    } catch {
      // JSON parse failed, fall through to meta tag extraction
    }
  }

  // Fallback: extract from meta tags
  if (!videoUrl) {
    // Try originVideoKey from raw HTML
    const keyMatch = html.match(/"originVideoKey"\s*:\s*"([^"]+)"/);
    if (keyMatch) {
      const key = keyMatch[1].replace(/\\u002F/g, "/");
      videoUrl = VIDEO_CDN_HOSTS[0] + key;
    }
  }

  // Another fallback: og:video meta tag (this one has watermark)
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
      "This note does not contain a video, or the video could not be extracted",
    );
  }

  const videos: VideoParseResult["videos"] = [];

  if (videoUrl) {
    videos.push({
      qualityLabel: "原始画质 (无水印)",
      format: "mp4",
      hasAudio: true,
      hasVideo: true,
      url: videoUrl,
      isWatermarked: false,
    });
  }

  if (ogVideoUrl && ogVideoUrl !== videoUrl) {
    videos.push({
      qualityLabel: "标准画质 (有水印)",
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
