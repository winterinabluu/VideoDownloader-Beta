import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";
import { spawn } from "node:child_process";

const YTDLP_TIMEOUT_MS = 30_000;

// ── yt-dlp JSON types (subset we care about) ────────────────────────

export interface YtdlpFormat {
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

export interface YtdlpOutput {
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
  webpage_url: string;
  formats: YtdlpFormat[];
}

// ── Core runner ─────────────────────────────────────────────────────

/**
 * Run yt-dlp --dump-json and return parsed JSON output.
 */
export function runYtdlp(
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
              "This video is private or requires login.",
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

// ── Shared helpers ──────────────────────────────────────────────────

export function hasVideo(f: YtdlpFormat): boolean {
  return !!f.vcodec && f.vcodec !== "none";
}

export function hasAudio(f: YtdlpFormat): boolean {
  return !!f.acodec && f.acodec !== "none";
}

export function formatSize(f: YtdlpFormat): number | undefined {
  return f.filesize ?? f.filesize_approx ?? undefined;
}

export function codecLabel(codec: string | null): string {
  if (!codec || codec === "none") return "";
  const base = codec.split(".")[0].toUpperCase();
  if (base === "AVC1") return "H264";
  if (base === "HEV1" || base === "HVC1") return "H265";
  if (base === "VP9" || base === "VP09") return "VP9";
  if (base.startsWith("AV01")) return "AV1";
  return base;
}

export function buildQualityLabel(f: YtdlpFormat): string {
  const h = f.height ?? 0;
  const fpsStr = f.fps && f.fps > 30 ? `${Math.round(f.fps)}` : "";
  const resolution = h > 0 ? `${h}p${fpsStr}` : "Audio";
  const codec = codecLabel(f.vcodec);
  return codec ? `${resolution} · ${codec}` : resolution;
}

export function toVideoFormat(ext: string): "mp4" | "webm" {
  if (ext === "mp4" || ext === "m4a") return "mp4";
  if (ext === "webm") return "webm";
  return "mp4";
}
