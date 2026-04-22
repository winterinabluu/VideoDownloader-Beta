import { sanitizeFilename } from "@vd/shared";
import { spawn } from "node:child_process";
import { config } from "../config.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Stream a video from its source URL and return a Response suitable
 * for sending directly to the client. Sets correct Content-Type and
 * Content-Disposition headers so the browser triggers a download.
 */
export async function proxyDownload(params: {
  videoUrl: string;
  filename: string;
  headers?: Record<string, string>;
}): Promise<Response> {
  const { videoUrl, filename, headers = {} } = params;

  const reqHeaders: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    ...headers,
  };

  const upstream = await fetch(videoUrl, {
    headers: reqHeaders,
    redirect: "follow",
  });

  if (!upstream.ok) {
    throw new Error(`Upstream responded with ${upstream.status}`);
  }

  const safeName = sanitizeFilename(filename) || "video";
  const ext = safeName.endsWith(".mp4") ? "" : ".mp4";
  const fullName = safeName + ext;

  // Content-Disposition has two forms:
  //   filename="..."         — legacy, MUST be ASCII-only (RFC 6266 / ByteString)
  //   filename*=UTF-8''...   — RFC 5987, carries the real Unicode name
  // Modern browsers prefer filename*, but we still need an ASCII fallback for
  // the legacy parameter because Node's fetch Headers refuse non-ASCII bytes.
  const asciiFallback =
    fullName.replace(/[^\x20-\x7e]/g, "_").replace(/_+/g, "_") || "video.mp4";

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", "video/mp4");
  responseHeaders.set(
    "Content-Disposition",
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fullName)}`,
  );

  // Forward content-length if available
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    responseHeaders.set("Content-Length", contentLength);
  }

  responseHeaders.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * Merge separate video and audio streams (DASH) using ffmpeg and return a
 * streamable Response. ffmpeg reads both URLs directly and remuxes to a
 * fragmented MP4 written to stdout.
 */
export function mergeDownload(params: {
  videoUrl: string;
  audioUrl: string;
  filename: string;
  headers?: Record<string, string>;
}): Response {
  const { videoUrl, audioUrl, filename, headers = {} } = params;

  const safeName = sanitizeFilename(filename) || "video";
  const ext = safeName.endsWith(".mp4") ? "" : ".mp4";
  const fullName = safeName + ext;

  const asciiFallback =
    fullName.replace(/[^\x20-\x7e]/g, "_").replace(/_+/g, "_") || "video.mp4";

  // Build the HTTP headers string that ffmpeg sends with each input.
  const ua = headers["User-Agent"] ?? DEFAULT_UA;
  const headerLines = [`User-Agent: ${ua}`];
  if (headers["Referer"]) headerLines.push(`Referer: ${headers["Referer"]}`);
  if (headers["Cookie"]) headerLines.push(`Cookie: ${headers["Cookie"]}`);
  const httpHeaders = headerLines.map((h) => h + "\r\n").join("");

  const ffmpeg = spawn(config.ffmpegPath, [
    "-headers", httpHeaders,
    "-i", videoUrl,
    "-headers", httpHeaders,
    "-i", audioUrl,
    "-c", "copy",
    "-movflags", "frag_keyframe+empty_moov",
    "-f", "mp4",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "ignore"] });

  // Convert the child process stdout (Node stream) into a web ReadableStream.
  const body = new ReadableStream({
    start(controller) {
      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      ffmpeg.stdout.on("end", () => {
        controller.close();
      });
      ffmpeg.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      ffmpeg.kill("SIGTERM");
    },
  });

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", "video/mp4");
  responseHeaders.set(
    "Content-Disposition",
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fullName)}`,
  );
  responseHeaders.set("Cache-Control", "no-store");

  return new Response(body, { status: 200, headers: responseHeaders });
}
