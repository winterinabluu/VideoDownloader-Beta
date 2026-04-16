import type { VideoParseResult, ApiResponse } from "@vd/shared";

const API_BASE = "/api";

export async function parseVideo(
  url: string,
): Promise<ApiResponse<VideoParseResult>> {
  const resp = await fetch(`${API_BASE}/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return resp.json();
}

export function getDownloadUrl(tokenUrl: string): string {
  // tokenUrl is already like "/api/download?token=xxx"
  return tokenUrl;
}
