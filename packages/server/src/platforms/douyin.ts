import type { VideoParseResult } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const DOUYIN_HOST_PATTERNS = [
  /^(?:www\.)?douyin\.com$/i,
  /^v\.douyin\.com$/i,
];

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
    // TODO: implement douyin parser
    throw new AppError(
      ErrorCodes.UNSUPPORTED_PLATFORM,
      "Douyin parser is not yet implemented",
      { detail: url },
    );
  },
};
