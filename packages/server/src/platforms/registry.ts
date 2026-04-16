import type { Platform } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import { twitterParser } from "./twitter.js";
import { xiaohongshuParser } from "./xiaohongshu.js";
import { bilibiliParser } from "./bilibili.js";
import { youtubeParser } from "./youtube.js";
import { weiboParser } from "./weibo.js";
import { douyinParser } from "./douyin.js";

/**
 * All registered platform parsers, checked in order.
 * Add new parsers here to enable detection.
 */
const parsers: PlatformParser[] = [
  twitterParser,
  xiaohongshuParser,
  bilibiliParser,
  youtubeParser,
  weiboParser,
  douyinParser,
];

export interface DetectResult {
  platform: Platform;
  parser: PlatformParser;
}

/**
 * Detect which platform a URL belongs to.
 * Returns the matched platform and its parser, or null if unsupported.
 */
export function detectPlatform(url: string): DetectResult | null {
  for (const parser of parsers) {
    if (parser.match(url)) {
      return { platform: parser.name as Platform, parser };
    }
  }
  return null;
}

/**
 * Get all registered parser names (for health check / debugging).
 */
export function listPlatforms(): string[] {
  return parsers.map((p) => p.name);
}
