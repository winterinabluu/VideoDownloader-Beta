import type { VideoParseResult } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const WEIBO_HOST_PATTERNS = [
  /^(?:www\.)?weibo\.com$/i,
  /^m\.weibo\.cn$/i,
  /^weibo\.cn$/i,
  /^video\.weibo\.com$/i,
  /^t\.cn$/i,
];

export const weiboParser: PlatformParser = {
  name: "weibo",
  label: "微博",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return WEIBO_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, _config: AppConfig): Promise<VideoParseResult> {
    // TODO: implement weibo parser
    throw new AppError(
      ErrorCodes.UNSUPPORTED_PLATFORM,
      "Weibo parser is not yet implemented",
      { detail: url },
    );
  },
};
