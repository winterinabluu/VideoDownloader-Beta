import type { VideoParseResult } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const YOUTUBE_HOST_PATTERNS = [
  /^(?:www\.)?youtube\.com$/i,
  /^m\.youtube\.com$/i,
  /^youtu\.be$/i,
  /^music\.youtube\.com$/i,
];

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

  async parse(url: string, _config: AppConfig): Promise<VideoParseResult> {
    // TODO: implement YouTube parser (recommend yt-dlp integration)
    throw new AppError(
      ErrorCodes.UNSUPPORTED_PLATFORM,
      "YouTube parser is not yet implemented",
      { detail: url },
    );
  },
};
