import type { ApiError, ErrorCode } from "@vd/shared";
import { ErrorCodes } from "@vd/shared";

/**
 * Structured application error that can be serialized to API response.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly detail?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; detail?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? defaultStatusForCode(code);
    this.detail = options.detail;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

function defaultStatusForCode(code: ErrorCode): number {
  switch (code) {
    case ErrorCodes.INVALID_URL:
    case ErrorCodes.UNSUPPORTED_PLATFORM:
      return 400;
    case ErrorCodes.LOGIN_REQUIRED:
      return 401;
    case ErrorCodes.VIDEO_PRIVATE:
      return 403;
    case ErrorCodes.VIDEO_NOT_FOUND:
    case ErrorCodes.VIDEO_DELETED:
    case ErrorCodes.DOWNLOAD_EXPIRED:
      return 404;
    case ErrorCodes.RATE_LIMITED:
      return 429;
    case ErrorCodes.FILE_TOO_LARGE:
      return 413;
    case ErrorCodes.PARSE_FAILED:
    case ErrorCodes.DOWNLOAD_FAILED:
    case ErrorCodes.INTERNAL_ERROR:
    default:
      return 500;
  }
}
