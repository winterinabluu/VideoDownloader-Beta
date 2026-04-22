import type { VideoParseResult, VideoVariant } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const BILIBILI_HOST_PATTERNS = [
  /^(?:www\.)?bilibili\.com$/i,
  /^m\.bilibili\.com$/i,
  /^b23\.tv$/i,
];

const BV_PATTERN = /\/video\/(BV[A-Za-z0-9]+)/;
const AV_PATTERN = /\/video\/av(\d+)/i;

const BILIBILI_REFERER = "https://www.bilibili.com";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const VIDEO_INFO_API = "https://api.bilibili.com/x/web-interface/view";
const PLAYURL_API = "https://api.bilibili.com/x/player/playurl";

/** Bilibili quality number → human-readable label */
const QN_LABELS: Record<number, string> = {
  6: "240p",
  16: "360p",
  32: "480p",
  64: "720p",
  74: "720p60",
  80: "1080p",
  112: "1080p+",
  116: "1080p60",
  120: "4K",
  125: "HDR",
  126: "Dolby Vision",
  127: "8K",
};

// ── Bilibili API response types ──────────────────────────────────────

interface BilibiliApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface VideoPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

interface VideoInfoData {
  bvid: string;
  aid: number;
  title: string;
  desc: string;
  pic: string;
  duration: number;
  owner: { name: string; mid: number };
  pages: VideoPage[];
}

interface DurlEntry {
  url: string;
  backup_url?: string[];
  size: number;
  length: number; // milliseconds
  order: number;
}

interface PlayUrlData {
  quality: number;
  accept_quality: number[];
  accept_description: string[];
  durl?: DurlEntry[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Referer: BILIBILI_REFERER,
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

/**
 * Follow redirect chain for b23.tv short links.
 * Returns the final resolved URL.
 */
async function followRedirect(url: string): Promise<string> {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": DEFAULT_UA },
  });
  return resp.url;
}

/**
 * Extract BV/av ID and part number from a bilibili video URL.
 */
function extractVideoId(url: string): {
  bvid?: string;
  aid?: number;
  part: number;
} {
  const parsed = new URL(url);

  const bvMatch = parsed.pathname.match(BV_PATTERN);
  if (bvMatch) {
    const part = parseInt(parsed.searchParams.get("p") ?? "1", 10);
    return { bvid: bvMatch[1], part: Math.max(1, part) };
  }

  const avMatch = parsed.pathname.match(AV_PATTERN);
  if (avMatch) {
    const part = parseInt(parsed.searchParams.get("p") ?? "1", 10);
    return { aid: parseInt(avMatch[1], 10), part: Math.max(1, part) };
  }

  throw new AppError(
    ErrorCodes.INVALID_URL,
    "Cannot extract video ID from Bilibili URL",
    {
      detail:
        "URL must be in the format bilibili.com/video/BV... or bilibili.com/video/av...",
    },
  );
}

function normalizeCoverUrl(pic: string): string {
  if (pic.startsWith("//")) return "https:" + pic;
  return pic;
}

/**
 * Fetch video metadata from Bilibili's view API.
 */
async function fetchVideoInfo(
  id: { bvid?: string; aid?: number },
  cookie?: string,
): Promise<VideoInfoData> {
  const params = new URLSearchParams();
  if (id.bvid) params.set("bvid", id.bvid);
  else if (id.aid) params.set("aid", String(id.aid));

  const resp = await fetch(`${VIDEO_INFO_API}?${params}`, {
    headers: buildHeaders(cookie),
  });

  if (resp.status === 412) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      "Bilibili rate limit triggered. Please wait a moment and try again.",
    );
  }

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Bilibili API returned HTTP ${resp.status}`,
    );
  }

  const json = (await resp.json()) as BilibiliApiResponse<VideoInfoData>;

  if (json.code === -404) {
    throw new AppError(
      ErrorCodes.VIDEO_NOT_FOUND,
      "Video not found. It may have been deleted or is region-restricted.",
    );
  }
  if (json.code === -403) {
    throw new AppError(
      ErrorCodes.VIDEO_PRIVATE,
      "This video is private or requires special access.",
    );
  }
  if (json.code !== 0) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Bilibili API error: ${json.message}`,
      { detail: `code: ${json.code}` },
    );
  }

  return json.data;
}

/**
 * Fetch play URL for a specific quality level.
 * Uses legacy MP4 mode (fnval=1) which returns muxed audio+video streams.
 */
async function fetchPlayUrl(
  bvid: string,
  cid: number,
  qn: number,
  cookie?: string,
): Promise<PlayUrlData> {
  const params = new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: String(qn),
    fnval: "1",
    fourk: "1",
  });

  const resp = await fetch(`${PLAYURL_API}?${params}`, {
    headers: buildHeaders(cookie),
  });

  if (resp.status === 412) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      "Bilibili rate limit triggered. Please wait a moment and try again.",
    );
  }

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Bilibili playurl API returned HTTP ${resp.status}`,
    );
  }

  const json = (await resp.json()) as BilibiliApiResponse<PlayUrlData>;

  if (json.code === -412) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      "Bilibili rate limit triggered. Please wait a moment and try again.",
    );
  }

  if (json.code !== 0) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Bilibili playurl error: ${json.message}`,
      { detail: `code: ${json.code}` },
    );
  }

  return json.data;
}

// ── Parser ───────────────────────────────────────────────────────────

export const bilibiliParser: PlatformParser = {
  name: "bilibili",
  label: "哔哩哔哩",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return BILIBILI_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, config: AppConfig): Promise<VideoParseResult> {
    const cookie = config.cookies.bilibili;

    // Step 1: Resolve short links
    let resolvedUrl = url;
    try {
      const u = new URL(url);
      if (u.hostname === "b23.tv") {
        resolvedUrl = await followRedirect(url);
        // Verify the redirect landed on bilibili.com
        const resolved = new URL(resolvedUrl);
        if (
          !BILIBILI_HOST_PATTERNS.some((p) => p.test(resolved.hostname))
        ) {
          throw new AppError(
            ErrorCodes.INVALID_URL,
            "Short link did not resolve to a Bilibili video page",
            { detail: resolvedUrl },
          );
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        "Failed to resolve Bilibili short link",
        { detail: url },
      );
    }

    // Step 2: Extract video ID and part number
    const { bvid, aid, part } = extractVideoId(resolvedUrl);

    // Step 3: Fetch video info
    const info = await fetchVideoInfo({ bvid, aid }, cookie);
    const videoBvid = info.bvid; // always use the canonical bvid from API

    // Step 4: Select cid for the requested part
    if (!info.pages || info.pages.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "Video has no playable parts",
      );
    }

    if (part > info.pages.length) {
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        `Requested part ${part} but video only has ${info.pages.length} part(s)`,
      );
    }

    const page = info.pages[part - 1];
    const cid = page.cid;

    // Build title — append part info for multi-part videos
    let title = info.title;
    if (info.pages.length > 1) {
      title += ` (P${page.page} ${page.part})`;
    }

    // Step 5: Discover available qualities, then fetch each in parallel
    const discovery = await fetchPlayUrl(videoBvid, cid, 0, cookie);
    const acceptQuality = discovery.accept_quality ?? [];

    if (acceptQuality.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No available video qualities. The video may require login.",
      );
    }

    // Fetch all qualities in parallel
    const qualityResults = await Promise.all(
      acceptQuality.map(async (qn) => {
        try {
          const data = await fetchPlayUrl(videoBvid, cid, qn, cookie);
          return { qn, data };
        } catch {
          return null; // skip qualities that fail
        }
      }),
    );

    // Step 6: Build video variants
    const variantEntries: Array<{ qn: number; variant: VideoVariant }> = [];
    const seenQualities = new Set<number>();

    for (const result of qualityResults) {
      if (!result) continue;
      const { data } = result;
      const actualQn = data.quality;

      // Deduplicate — the API may return the same actual quality for multiple requested qn
      if (seenQualities.has(actualQn)) continue;
      seenQualities.add(actualQn);

      const durl = data.durl;
      if (!durl || durl.length === 0) continue;

      const entry = durl[0];
      variantEntries.push({
        qn: actualQn,
        variant: {
          qualityLabel: QN_LABELS[actualQn] ?? `${actualQn}`,
          format: "mp4",
          url: entry.url,
          size: entry.size,
          hasAudio: true,
          hasVideo: true,
        },
      });
    }

    if (variantEntries.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No downloadable streams found. The video may require login for playback.",
      );
    }

    // Sort by quality descending (higher qn = better quality)
    variantEntries.sort((a, b) => b.qn - a.qn);
    const variants = variantEntries.map((e) => e.variant);

    return {
      platform: "bilibili",
      sourceUrl: url,
      title,
      author: info.owner.name,
      coverUrl: normalizeCoverUrl(info.pic),
      duration: info.duration,
      watermarkStatus: "no_watermark",
      videos: variants,
    };
  },
};
