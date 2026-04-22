import type { VideoParseResult, VideoVariant, VideoFormat } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";
import { spawn } from "node:child_process";

const YOUTUBE_HOST_PATTERNS = [
  /^(?:www\.)?youtube\.com$/i,
  /^m\.youtube\.com$/i,
  /^youtu\.be$/i,
  /^music\.youtube\.com$/i,
];

const YTDLP_TIMEOUT_MS = 30_000;

// ── yt-dlp JSON types (subset we care about) ────────────────────────

interface YtdlpFormat {
  format_id: string;
  ext: string;
  vcodec: string | null;
  acodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  tbr: number | null;
  filesize: number | null;
  filesize_approx: number | null;
  url: string;
  protocol: string;
  http_headers?: Record<string, string>;
}

interface YtdlpOutput {
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
  webpage_url: string;
  formats: YtdlpFormat[];
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Run yt-dlp --dump-json and return parsed JSON output.
 */
function runYtdlp(
  ytdlpPath: string,
  url: string,
  cookie?: string,
): Promise<YtdlpOutput> {
  return new Promise((resolve, reject) => {
    const args = ["--dump-json", "--no-download", "--no-warnings"];

    // If cookies are provided, write to a temp arg
    // For now we support Netscape cookie format via --cookies
    if (cookie) {
      args.push("--cookies", cookie);
    }

    args.push(url);

    const proc = spawn(ytdlpPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: YTDLP_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(
        new AppError(
          ErrorCodes.PARSE_FAILED,
          "yt-dlp timed out. The video may be too long or the network is slow.",
        ),
      );
    }, YTDLP_TIMEOUT_MS);

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new AppError(
            ErrorCodes.PARSE_FAILED,
            `yt-dlp not found at "${ytdlpPath}". Please install yt-dlp or set YTDLP_PATH in .env.`,
          ),
        );
      } else {
        reject(
          new AppError(ErrorCodes.PARSE_FAILED, `yt-dlp error: ${err.message}`),
        );
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        const lowerErr = stderr.toLowerCase();
        if (
          lowerErr.includes("private video") ||
          lowerErr.includes("sign in to confirm")
        ) {
          reject(
            new AppError(
              ErrorCodes.VIDEO_PRIVATE,
              "This video is private or age-restricted.",
            ),
          );
        } else if (
          lowerErr.includes("video unavailable") ||
          lowerErr.includes("is not available") ||
          lowerErr.includes("has been removed")
        ) {
          reject(
            new AppError(
              ErrorCodes.VIDEO_NOT_FOUND,
              "Video not found. It may have been deleted or is unavailable in your region.",
            ),
          );
        } else {
          reject(
            new AppError(
              ErrorCodes.PARSE_FAILED,
              `yt-dlp failed (exit code ${code})`,
              { detail: stderr.slice(0, 300) },
            ),
          );
        }
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(
          new AppError(
            ErrorCodes.PARSE_FAILED,
            "Failed to parse yt-dlp output",
          ),
        );
      }
    });
  });
}

function hasVideo(f: YtdlpFormat): boolean {
  return !!f.vcodec && f.vcodec !== "none";
}

function hasAudio(f: YtdlpFormat): boolean {
  return !!f.acodec && f.acodec !== "none";
}

function formatSize(f: YtdlpFormat): number | undefined {
  return f.filesize ?? f.filesize_approx ?? undefined;
}

function codecLabel(codec: string | null): string {
  if (!codec || codec === "none") return "";
  const base = codec.split(".")[0].toUpperCase();
  // Normalize common names
  if (base === "AVC1") return "H264";
  if (base === "HEV1" || base === "HVC1") return "H265";
  if (base === "VP9" || base === "VP09") return "VP9";
  if (base.startsWith("AV01")) return "AV1";
  return base;
}

function buildQualityLabel(f: YtdlpFormat): string {
  const h = f.height ?? 0;
  const fpsStr = f.fps && f.fps > 30 ? `${Math.round(f.fps)}` : "";
  const resolution = h > 0 ? `${h}p${fpsStr}` : "Audio";
  const codec = codecLabel(f.vcodec);
  return codec ? `${resolution} · ${codec}` : resolution;
}

function toVideoFormat(ext: string): VideoFormat {
  if (ext === "mp4" || ext === "m4a") return "mp4";
  if (ext === "webm") return "webm";
  return "mp4"; // default
}

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
