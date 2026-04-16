import { URL } from "url";

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
];

const BLOCKED_HOSTNAMES = ["localhost", "0.0.0.0", "[::1]"];

/**
 * Validate that a URL is safe to fetch (not pointing to internal resources).
 * Returns the parsed URL if valid, throws otherwise.
 */
export function validateUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error("Access to local addresses is not allowed");
  }

  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(hostname)) {
      throw new Error("Access to private IP ranges is not allowed");
    }
  }

  return url;
}

/**
 * Clean a string for use as a filename.
 * Removes characters not allowed in filenames and trims length.
 */
export function sanitizeFilename(name: string, maxLength = 100): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
