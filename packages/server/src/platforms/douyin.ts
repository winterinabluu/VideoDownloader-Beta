import type { VideoParseResult, VideoVariant } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DOUYIN_HOST_PATTERNS = [
  /^(?:www\.)?douyin\.com$/i,
  /^v\.douyin\.com$/i,
  /^(?:www\.)?iesdouyin\.com$/i,
];

const VIDEO_ID_RE = /\/video\/(\d+)/;

// Subset of the iesdouyin share-page JSON we read. Anything we don't touch is `unknown`.
interface DouyinBitRate {
  gear_name?: string;
  bit_rate?: number;
  play_addr?: { uri?: string; url_list?: string[] };
}
interface DouyinItem {
  aweme_id: string;
  desc: string;
  author?: { nickname?: string };
  video?: {
    play_addr?: { uri?: string; url_list?: string[] };
    cover?: { url_list?: string[] };
    height?: number;
    width?: number;
    duration?: number; // milliseconds
    bit_rate?: DouyinBitRate[] | null;
  };
}

/** Resolve any Douyin URL to its numeric video id (follows v.douyin.com short links). */
async function resolveVideoId(url: string): Promise<string> {
  const direct = new URL(url).pathname.match(VIDEO_ID_RE);
  if (direct) return direct[1];

  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "User-Agent": MOBILE_UA },
  });
  const loc = res.headers.get("location");
  const fromRedirect = loc?.match(VIDEO_ID_RE);
  if (!fromRedirect) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      "Could not resolve Douyin short link to a video id.",
    );
  }
  return fromRedirect[1];
}

/** playwm = watermarked, play = clean. Same backend, different path. */
function stripWatermark(url: string): string {
  return url.replace("/playwm/", "/play/");
}

/** Extract the served resolution from the URL's `ratio=` param if present. */
function ratioFromUrl(url: string): string | undefined {
  return url.match(/[?&]ratio=([^&]+)/)?.[1];
}

function buildVariant(
  rawUrl: string,
  video: NonNullable<DouyinItem["video"]>,
  fallbackLabel: string,
  bitrate?: number,
): VideoVariant {
  const ratio = ratioFromUrl(rawUrl);
  return {
    qualityLabel: ratio || fallbackLabel,
    width: video.width,
    height: video.height,
    bitrate,
    format: "mp4",
    url: stripWatermark(rawUrl),
    hasAudio: true,
    hasVideo: true,
    // Picked up by parse.ts:71 — the CDN returns 404 for desktop UAs.
    _downloadHeaders: { "User-Agent": MOBILE_UA },
  } as VideoVariant & { _downloadHeaders: Record<string, string> };
}

export const douyinParser: PlatformParser = {
  name: "douyin",
  label: "抖音",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return DOUYIN_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, _config: AppConfig): Promise<VideoParseResult> {
    const videoId = await resolveVideoId(url);
    const shareUrl = `https://www.iesdouyin.com/share/video/${videoId}/`;

    const res = await fetch(shareUrl, { headers: { "User-Agent": MOBILE_UA } });
    if (!res.ok) {
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        `Douyin share page returned HTTP ${res.status}`,
      );
    }
    const html = await res.text();

    const m = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]+?\})\s*<\/script>/);
    if (!m) {
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        "Could not locate video data in Douyin share page.",
      );
    }

    let payload: { loaderData?: Record<string, unknown> };
    try {
      payload = JSON.parse(m[1]);
    } catch {
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        "Douyin share page contains invalid JSON.",
      );
    }

    const pageKey = Object.keys(payload.loaderData ?? {}).find((k) =>
      k.includes("page"),
    );
    const pageNode = pageKey
      ? (payload.loaderData?.[pageKey] as
          | { videoInfoRes?: { item_list?: DouyinItem[] } }
          | undefined)
      : undefined;
    const item = pageNode?.videoInfoRes?.item_list?.[0];
    const video = item?.video;
    const playUrl = video?.play_addr?.url_list?.[0];

    if (!item || !video || !playUrl) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "Douyin video data not found. The video may have been deleted or region-locked.",
      );
    }

    const variants: VideoVariant[] = [];
    const bitRates = Array.isArray(video.bit_rate) ? video.bit_rate : [];
    const seenUris = new Set<string>();

    for (const br of bitRates) {
      const u = br.play_addr?.url_list?.[0];
      const uri = br.play_addr?.uri ?? "";
      if (!u || seenUris.has(uri)) continue;
      seenUris.add(uri);
      const label = br.gear_name || (video.height ? `${video.height}p` : "default");
      variants.push(buildVariant(u, video, label, br.bit_rate));
    }

    if (variants.length === 0) {
      // Single quality fallback
      variants.push(
        buildVariant(playUrl, video, video.height ? `${video.height}p` : "default"),
      );
    }

    return {
      platform: "douyin",
      sourceUrl: shareUrl,
      title: item.desc || `Douyin video ${item.aweme_id}`,
      author: item.author?.nickname,
      coverUrl: video.cover?.url_list?.[0],
      duration:
        typeof video.duration === "number"
          ? Math.round(video.duration / 1000)
          : undefined,
      watermarkStatus: "no_watermark",
      videos: variants,
    };
  },
};
