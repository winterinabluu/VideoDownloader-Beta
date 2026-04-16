import type { VideoParseResult } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const BILIBILI_HOST_PATTERNS = [
  /^(?:www\.)?bilibili\.com$/i,
  /^m\.bilibili\.com$/i,
  /^b23\.tv$/i,
];

export const bilibiliParser: PlatformParser = {
  name: "bilibili",
  label: "哔哩哔哩",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return BILIBILI_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, _config: AppConfig): Promise<VideoParseResult> {
    // TODO: implement bilibili parser
    throw new AppError(
      ErrorCodes.UNSUPPORTED_PLATFORM,
      "Bilibili parser is not yet implemented",
      { detail: url },
    );
  },
};
