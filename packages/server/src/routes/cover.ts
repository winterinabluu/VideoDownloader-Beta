import { Hono } from "hono";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

/**
 * Platform-specific headers needed to fetch cover images that have
 * hotlink protection (e.g. Weibo sinaimg.cn requires Referer).
 */
const COVER_REFERERS: Record<string, string> = {
  "sinaimg.cn": "https://weibo.com/",
  "bilivideo.com": "https://www.bilibili.com",
  "hdslb.com": "https://www.bilibili.com",
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const ALLOWED_HOSTS = new Set([
  "sinaimg.cn",
  "bilivideo.com",
  "hdslb.com",
]);

/** Check if a hostname belongs to an allowed CDN domain */
function isAllowedHost(hostname: string): boolean {
  for (const allowed of ALLOWED_HOSTS) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

/** Find the matching referer for a hostname */
function getReferer(hostname: string): string | undefined {
  for (const [domain, referer] of Object.entries(COVER_REFERERS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return referer;
    }
  }
  return undefined;
}

const app = new Hono();

app.get("/", async (c) => {
  const url = c.req.query("url");

  if (!url) {
    throw new AppError(ErrorCodes.INVALID_URL, "Missing 'url' query parameter");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ErrorCodes.INVALID_URL, "Invalid cover URL");
  }

  if (!isAllowedHost(parsed.hostname)) {
    throw new AppError(
      ErrorCodes.INVALID_URL,
      "Cover proxy only supports known CDN domains",
    );
  }

  const referer = getReferer(parsed.hostname);
  const headers: Record<string, string> = { "User-Agent": DEFAULT_UA };
  if (referer) headers.Referer = referer;

  const resp = await fetch(url, { headers });

  if (!resp.ok || !resp.body) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Cover image fetch failed: HTTP ${resp.status}`,
    );
  }

  const contentType = resp.headers.get("content-type") ?? "image/jpeg";

  return new Response(resp.body as ReadableStream, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

export { app as coverRoute };
