import type { VideoParseResult } from "@vd/shared";
import type { AppConfig } from "../config.js";

export interface ParseOptions {
  cookie?: string;
  userAgent?: string;
}

/**
 * Base interface for all platform parsers.
 * Each platform implements its own parser module that conforms to this interface.
 */
export interface PlatformParser {
  /** Unique platform identifier */
  name: string;

  /** Human-readable platform label */
  label: string;

  /**
   * Test whether a URL belongs to this platform.
   * Should be fast — only check hostname/pattern, no network requests.
   */
  match(url: string): boolean;

  /**
   * Parse the video from the given URL.
   * May make network requests to fetch page data / API responses.
   */
  parse(url: string, config: AppConfig): Promise<VideoParseResult>;
}
