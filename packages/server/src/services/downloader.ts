import { sanitizeFilename } from "@vd/shared";

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
