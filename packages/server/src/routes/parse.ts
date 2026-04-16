import { Hono } from "hono";
import type { ParseRequest } from "@vd/shared";
import { validateUrl, ErrorCodes } from "@vd/shared";
import { AppError } from "../errors.js";
import { detectPlatform } from "../platforms/registry.js";
import { config } from "../config.js";

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
  return c.json({ ok: true, data: result });
});

export { app as parseRoute };
