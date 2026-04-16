import { Hono } from "hono";
import type { ParseRequest } from "@vd/shared";
import { validateUrl, ErrorCodes } from "@vd/shared";
import { AppError } from "../errors.js";

const app = new Hono();

app.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as ParseRequest | null;

  if (!body || typeof body.url !== "string" || body.url.length === 0) {
    throw new AppError(
      ErrorCodes.INVALID_URL,
      "Request body must contain a 'url' string",
    );
  }

  try {
    validateUrl(body.url);
  } catch (err) {
    throw new AppError(
      ErrorCodes.INVALID_URL,
      err instanceof Error ? err.message : "Invalid URL",
    );
  }

  // TODO: dispatch to platform parser (implemented in next task)
  throw new AppError(
    ErrorCodes.UNSUPPORTED_PLATFORM,
    "Platform parsers not yet implemented",
    { detail: body.url },
  );
});

export { app as parseRoute };
