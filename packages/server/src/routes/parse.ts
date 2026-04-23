import { Hono } from "hono";
import type { ParseRequest } from "@vd/shared";
import { validateUrl, ErrorCodes } from "@vd/shared";
import { AppError } from "../errors.js";
import { detectPlatform } from "../platforms/registry.js";
import { config } from "../config.js";
import { createDownloadToken } from "../services/tokenStore.js";

/** Headers that must accompany download requests for specific platforms (e.g. Referer). */
const PLATFORM_DOWNLOAD_HEADERS: Record<string, Record<string, string>> = {
  bilibili: { Referer: "https://www.bilibili.com" },
  weibo: { Referer: "https://weibo.com/" },
};

const app = new Hono();

app.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as ParseRequest | null;

  if (!body || typeof body.url !== "string" || body.url.length === 0) {
    throw new AppError(
      ErrorCodes.INVALID_URL,
      "Request body must contain a 'url' string",
    );
  }

  const urlStr = body.url.trim();

  try {
    validateUrl(urlStr);
  } catch (err) {
    throw new AppError(
      ErrorCodes.INVALID_URL,
      err instanceof Error ? err.message : "Invalid URL",
    );
  }

  const detected = detectPlatform(urlStr);
  if (!detected) {
    throw new AppError(
      ErrorCodes.UNSUPPORTED_PLATFORM,
      "This URL is not from a supported platform",
      { detail: urlStr },
    );
  }

  const result = await detected.parser.parse(urlStr, config);

  // Replace raw video URLs with download tokens for security
  const filename = result.title ?? `video_${Date.now()}`;
  const platformHeaders = PLATFORM_DOWNLOAD_HEADERS[result.platform];
  const videosWithTokens = result.videos.map((v) => {
    // Per-variant headers (e.g. yt-dlp http_headers) take priority over platform-level
    const variantHeaders = (v as any)._downloadHeaders as
      | Record<string, string>
      | undefined;
    const headers = variantHeaders ?? platformHeaders;
    const token = createDownloadToken({
      videoUrl: v.url,
      audioUrl: (v as any)._audioUrl,
      platform: result.platform,
      filename: `${filename}_${v.qualityLabel}`,
      headers,
    });
    // Strip internal properties before sending to client
    const { _audioUrl: _a, _downloadHeaders: _h, ...cleanVariant } = v as any;
    return {
      ...cleanVariant,
      url: `/api/download?token=${token}`,
    };
  });

  return c.json({
    ok: true,
    data: { ...result, videos: videosWithTokens },
  });
});

export { app as parseRoute };
