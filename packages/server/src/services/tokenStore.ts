import crypto from "node:crypto";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

interface DownloadToken {
  videoUrl: string;
  platform: string;
  filename: string;
  headers?: Record<string, string>;
  expiresAt: number;
}

const tokenStore = new Map<string, DownloadToken>();

// Periodic cleanup of expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [id, token] of tokenStore) {
    if (token.expiresAt < now) tokenStore.delete(id);
  }
}, 60_000).unref?.();

/**
 * Create a download token that expires after the configured TTL.
 * Returns the token ID.
 */
export function createDownloadToken(params: {
  videoUrl: string;
  platform: string;
  filename: string;
  headers?: Record<string, string>;
}): string {
  const id = crypto.randomBytes(16).toString("hex");
  tokenStore.set(id, {
    ...params,
    expiresAt: Date.now() + config.downloadCacheTtlSeconds * 1000,
  });
  return id;
}

/**
 * Retrieve and consume a download token.
 * Returns the stored download info.
 */
export function getDownloadToken(id: string): DownloadToken {
  const token = tokenStore.get(id);
  if (!token) {
    throw new AppError(
      ErrorCodes.DOWNLOAD_EXPIRED,
      "Download link has expired or is invalid. Please parse the video again.",
    );
  }
  if (token.expiresAt < Date.now()) {
    tokenStore.delete(id);
    throw new AppError(
      ErrorCodes.DOWNLOAD_EXPIRED,
      "Download link has expired. Please parse the video again.",
    );
  }
  return token;
}
