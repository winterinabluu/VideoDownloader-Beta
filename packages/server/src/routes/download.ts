import { Hono } from "hono";
import { ErrorCodes } from "@vd/shared";
import { AppError } from "../errors.js";
import { getDownloadToken } from "../services/tokenStore.js";
import { proxyDownload, mergeDownload } from "../services/downloader.js";

const app = new Hono();

app.get("/", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    throw new AppError(
      ErrorCodes.INVALID_URL,
      "Missing 'token' query parameter",
    );
  }

  const info = getDownloadToken(token);

  // DASH content: merge separate video + audio streams via ffmpeg
  if (info.audioUrl) {
    return mergeDownload({
      videoUrl: info.videoUrl,
      audioUrl: info.audioUrl,
      filename: info.filename,
      headers: info.headers,
    });
  }

  const response = await proxyDownload({
    videoUrl: info.videoUrl,
    filename: info.filename,
    headers: info.headers,
  });

  return response;
});

export { app as downloadRoute };
