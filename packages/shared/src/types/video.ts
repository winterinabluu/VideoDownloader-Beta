/** Supported platform identifiers */
export type Platform =
  | "twitter"
  | "xiaohongshu"
  | "bilibili"
  | "youtube"
  | "weibo"
  | "douyin"
  | "unknown";

/** Watermark status for the parsed video */
export type WatermarkStatus =
  | "no_watermark"
  | "watermarked"
  | "unknown"
  | "not_supported";

/** Video container format */
export type VideoFormat = "mp4" | "m3u8" | "webm" | "unknown";

/** A single video quality variant */
export interface VideoVariant {
  qualityLabel: string;
  width?: number;
  height?: number;
  bitrate?: number;
  fps?: number;
  format: VideoFormat;
  hasAudio?: boolean;
  hasVideo?: boolean;
  url: string;
  size?: number;
  isWatermarked?: boolean;
}

/** Unified parse result from any platform */
export interface VideoParseResult {
  platform: Platform;
  sourceUrl: string;
  title?: string;
  author?: string;
  coverUrl?: string;
  duration?: number;
  watermarkStatus: WatermarkStatus;
  videos: VideoVariant[];
}

/** API request body for /api/parse */
export interface ParseRequest {
  url: string;
}

/** Successful API response */
export interface ApiSuccessResponse<T> {
  ok: true;
  data: T;
}

/** Error detail */
export interface ApiError {
  code: string;
  message: string;
  detail?: string;
}

/** Failed API response */
export interface ApiErrorResponse {
  ok: false;
  error: ApiError;
}

/** Union API response type */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Error codes used across the application */
export const ErrorCodes = {
  INVALID_URL: "INVALID_URL",
  UNSUPPORTED_PLATFORM: "UNSUPPORTED_PLATFORM",
  PARSE_FAILED: "PARSE_FAILED",
  DOWNLOAD_FAILED: "DOWNLOAD_FAILED",
  VIDEO_NOT_FOUND: "VIDEO_NOT_FOUND",
  VIDEO_PRIVATE: "VIDEO_PRIVATE",
  VIDEO_DELETED: "VIDEO_DELETED",
  LOGIN_REQUIRED: "LOGIN_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DOWNLOAD_EXPIRED: "DOWNLOAD_EXPIRED",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
