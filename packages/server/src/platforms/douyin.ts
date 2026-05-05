import type { VideoParseResult, VideoVariant } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";
import {
  runYtdlp,
  hasVideo,
  hasAudio,
  formatSize,
  buildQualityLabel,
  toVideoFormat,
} from "./ytdlp.js";

const DOUYIN_HOST_PATTERNS = [
  /^(?:www\.)?douyin\.com$/i,
  /^v\.douyin\.com$/i,
];

// ── Parser ───────────────────────────────────────────────────────────

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

  async parse(url: string, config: AppConfig): Promise<VideoParseResult> {
    const info = await runYtdlp(config.ytdlpPath, url, config.cookies.douyin);

    // Douyin videos are typically muxed MP4 — prefer muxed formats with video
    const allVideo = info.formats.filter(
      (f) => f.protocol === "https" && hasVideo(f),
    );

    if (allVideo.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No downloadable video formats found for this Douyin video.",
      );
    }

    // Prefer muxed (has both audio and video), then video-only as fallback
    const muxed = allVideo.filter((f) => hasAudio(f));
    const candidates = muxed.length > 0 ? muxed : allVideo;

    // Deduplicate by resolution, keeping highest bitrate per height
    const byHeight = new Map<number, typeof candidates[0]>();
    for (const f of candidates) {
      const h = f.height ?? 0;
      const existing = byHeight.get(h);
      if (!existing || (f.tbr ?? 0) > (existing.tbr ?? 0)) {
        byHeight.set(h, f);
      }
    }

    const variants: VideoVariant[] = [];
    for (const f of byHeight.values()) {
      variants.push({
        qualityLabel: buildQualityLabel(f),
        width: f.width ?? undefined,
        height: f.height ?? undefined,
        bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
        fps: f.fps ?? undefined,
        format: toVideoFormat(f.ext),
        url: f.url,
        size: formatSize(f),
        hasAudio: hasAudio(f),
        hasVideo: true,
      });
    }

    // Sort by height descending
    variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    if (variants.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No downloadable video formats found for this Douyin video.",
      );
    }

    return {
      platform: "douyin",
      sourceUrl: info.webpage_url || url,
      title: info.title,
      author: info.uploader,
      coverUrl: info.thumbnail,
      duration: info.duration,
      watermarkStatus: "no_watermark",
      videos: variants,
    };
  },
};
