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
  type YtdlpFormat,
} from "./ytdlp.js";

const YOUTUBE_HOST_PATTERNS = [
  /^(?:www\.)?youtube\.com$/i,
  /^m\.youtube\.com$/i,
  /^youtu\.be$/i,
  /^music\.youtube\.com$/i,
];

// ── Parser ───────────────────────────────────────────────────────────

export const youtubeParser: PlatformParser = {
  name: "youtube",
  label: "YouTube",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return YOUTUBE_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, config: AppConfig): Promise<VideoParseResult> {
    const info = await runYtdlp(config.ytdlpPath, url, config.cookies.youtube);

    const formats = info.formats.filter(
      (f) => f.protocol === "https" && hasVideo(f),
    );

    if (formats.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No downloadable video formats found.",
      );
    }

    // Find best audio track for DASH pairing
    const audioTracks = info.formats
      .filter(
        (f) =>
          f.protocol === "https" &&
          hasAudio(f) &&
          !hasVideo(f) &&
          (f.ext === "m4a" || f.ext === "webm"),
      )
      .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0));

    // Best audio per container type for codec compatibility
    const bestM4aAudio = audioTracks.find((a) => a.ext === "m4a");
    const bestWebmAudio = audioTracks.find((a) => a.ext === "webm");

    // Separate muxed and video-only formats
    const muxed = formats.filter((f) => hasAudio(f));
    const videoOnly = formats.filter((f) => !hasAudio(f));

    // Build variants — prefer DASH video-only (higher quality), include muxed as fallback
    const variants: (VideoVariant & {
      _audioUrl?: string;
      _downloadHeaders?: Record<string, string>;
    })[] = [];
    const seenResolutions = new Set<string>();

    // DASH video-only tracks (paired with best audio)
    // Prefer AVC/H264, then AV1, then VP9 for each resolution
    const dashByHeight = new Map<
      number,
      YtdlpFormat[]
    >();
    for (const f of videoOnly) {
      const h = f.height ?? 0;
      if (h === 0) continue;
      const arr = dashByHeight.get(h) ?? [];
      arr.push(f);
      dashByHeight.set(h, arr);
    }

    for (const [height, tracks] of dashByHeight) {
      // Sort: prefer mp4/avc, then by bitrate
      tracks.sort((a, b) => {
        const aIsAvc = a.ext === "mp4" ? 1 : 0;
        const bIsAvc = b.ext === "mp4" ? 1 : 0;
        if (aIsAvc !== bIsAvc) return bIsAvc - aIsAvc;
        return (b.tbr ?? 0) - (a.tbr ?? 0);
      });

      const best = tracks[0];
      const key = `${height}p`;
      if (seenResolutions.has(key)) continue;
      seenResolutions.add(key);

      // Pick compatible audio: m4a for mp4 container, webm for webm
      const audio =
        best.ext === "mp4" ? bestM4aAudio : bestWebmAudio ?? bestM4aAudio;

      variants.push({
        qualityLabel: buildQualityLabel(best),
        width: best.width ?? undefined,
        height: best.height ?? undefined,
        bitrate: best.tbr ? Math.round(best.tbr * 1000) : undefined,
        fps: best.fps ?? undefined,
        format: toVideoFormat(best.ext),
        url: best.url,
        size: formatSize(best),
        hasAudio: false,
        hasVideo: true,
        _audioUrl: audio?.url,
        _downloadHeaders: best.http_headers,
      });
    }

    // Muxed formats as fallback (usually lower quality, max 720p)
    for (const f of muxed) {
      const h = f.height ?? 0;
      const key = `${h}p`;
      if (seenResolutions.has(key)) continue;
      seenResolutions.add(key);

      variants.push({
        qualityLabel: buildQualityLabel(f),
        width: f.width ?? undefined,
        height: f.height ?? undefined,
        bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
        fps: f.fps ?? undefined,
        format: toVideoFormat(f.ext),
        url: f.url,
        size: formatSize(f),
        hasAudio: true,
        hasVideo: true,
        _downloadHeaders: f.http_headers,
      });
    }

    // Sort by height descending
    variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    if (variants.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No downloadable video formats found.",
      );
    }

    return {
      platform: "youtube",
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
