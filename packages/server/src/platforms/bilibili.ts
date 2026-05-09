import type { VideoParseResult, VideoVariant, VideoFormat } from "@vd/shared";
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

interface DashTrack {
  id: number; // qn for video, codec id for audio
  baseUrl: string;
  base_url: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  mimeType?: string;
  mime_type?: string;
}

interface PlayUrlData {
  quality: number;
  accept_quality: number[];
  accept_description: string[];
  dash?: {
    video: DashTrack[];
    audio: DashTrack[];
  };
  durl?: Array<{
    url: string;
    backup_url?: string[];
    size: number;
    length: number;
    order: number;
  }>;
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
  if (pic.startsWith("http://")) return pic.replace("http://", "https://");
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
 * Fetch play URL using DASH mode (fnval=16) which returns separate
 * video and audio tracks at all available quality levels in one request.
 */
async function fetchPlayUrl(
  bvid: string,
  cid: number,
  cookie?: string,
): Promise<PlayUrlData> {
  const params = new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: "127",
    fnval: "16",
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

function getTrackUrl(track: DashTrack): string {
  return track.baseUrl || track.base_url;
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

    // Step 5: Fetch DASH streams (single request returns all qualities)
    const playData = await fetchPlayUrl(videoBvid, cid, cookie);

    // Step 6: Build video variants from DASH tracks
    const variants: (VideoVariant & { _audioUrl?: string })[] = [];
    const warnings: string[] = [];

    if (playData.dash) {
      const { video: videoTracks, audio: audioTracks } = playData.dash;

      // Pick the best audio track (highest bandwidth)
      const bestAudio = audioTracks
        ?.slice()
        .sort((a, b) => b.bandwidth - a.bandwidth)[0];
      const audioUrl = bestAudio ? getTrackUrl(bestAudio) : undefined;

      // Deduplicate video tracks: keep the highest bandwidth per qn (e.g. AVC over HEVC if larger)
      const bestByQn = new Map<number, DashTrack>();
      for (const vt of videoTracks ?? []) {
        const existing = bestByQn.get(vt.id);
        // Prefer AVC (avc1) for broadest compatibility; if same codec family, pick higher bandwidth
        const isAvc = vt.codecs?.startsWith("avc") ?? false;
        const existingIsAvc = existing?.codecs?.startsWith("avc") ?? false;
        if (
          !existing ||
          (isAvc && !existingIsAvc) ||
          (isAvc === existingIsAvc && vt.bandwidth > existing.bandwidth)
        ) {
          bestByQn.set(vt.id, vt);
        }
      }

      for (const [qn, track] of bestByQn) {
        const label = QN_LABELS[qn] ?? `${qn}`;
        const codec = track.codecs?.split(".")[0]?.toUpperCase() ?? "";
        const qualityLabel = codec ? `${label} · ${codec}` : label;

        variants.push({
          qualityLabel,
          width: track.width,
          height: track.height,
          bitrate: track.bandwidth,
          format: "mp4" as VideoFormat,
          url: getTrackUrl(track),
          hasAudio: !audioUrl, // true only if no separate audio (muxed)
          hasVideo: true,
          _audioUrl: audioUrl,
        });
      }
    }

    // Fallback: legacy durl mode (some old videos)
    if (variants.length === 0 && playData.durl && playData.durl.length > 0) {
      const entry = playData.durl[0];
      variants.push({
        qualityLabel: QN_LABELS[playData.quality] ?? `${playData.quality}`,
        format: "mp4" as VideoFormat,
        url: entry.url,
        size: entry.size,
        hasAudio: true,
        hasVideo: true,
      });
    }

    if (variants.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_NOT_FOUND,
        "No downloadable streams found. The video may require login for playback.",
      );
    }

    // Sort by qn / bitrate descending (highest quality first)
    variants.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

    // Diagnose quality gap: if Bilibili says higher qualities exist (accept_quality
    // includes them) but DASH only delivered lower ones, the request was treated
    // as anonymous — most commonly because BILIBILI_COOKIE is missing or its
    // SESSDATA expired. Surface this as a non-fatal warning.
    const deliveredMaxQn = Math.max(
      0,
      ...(playData.dash?.video ?? []).map((v) => v.id),
    );
    const accessibleMaxQn = Math.max(0, ...(playData.accept_quality ?? []));
    if (accessibleMaxQn > deliveredMaxQn && deliveredMaxQn > 0) {
      const accessibleLabel = QN_LABELS[accessibleMaxQn] ?? `qn=${accessibleMaxQn}`;
      const deliveredLabel = QN_LABELS[deliveredMaxQn] ?? `qn=${deliveredMaxQn}`;
      warnings.push(
        cookie
          ? `B 站只下发了 ${deliveredLabel} 及以下，但视频实际有 ${accessibleLabel}。BILIBILI_COOKIE 中的 SESSDATA 可能已过期，请重新获取。`
          : `B 站当前未登录，最高只能拿到 ${deliveredLabel}（视频实际有 ${accessibleLabel}）。在 packages/server/.env 配置 BILIBILI_COOKIE=SESSDATA=… 可解锁高清。`,
      );
    }

    return {
      platform: "bilibili",
      sourceUrl: url,
      title,
      author: info.owner.name,
      coverUrl: normalizeCoverUrl(info.pic),
      duration: info.duration,
      watermarkStatus: "no_watermark",
      videos: variants,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
