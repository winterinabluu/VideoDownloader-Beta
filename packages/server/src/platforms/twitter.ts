import type { VideoParseResult } from "@vd/shared";
import type { PlatformParser } from "./base.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

const TWITTER_HOST_PATTERNS = [
  /^(?:www\.)?twitter\.com$/i,
  /^(?:www\.)?x\.com$/i,
  /^mobile\.twitter\.com$/i,
  /^mobile\.x\.com$/i,
];

const TWEET_PATH_PATTERN = /^\/[^/]+\/status\/(\d+)/;

// Static bearer token used by Twitter's web client
const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

interface TwitterVariant {
  bitrate?: number;
  content_type: string;
  url: string;
}

interface TwitterMediaEntity {
  type: string;
  video_info?: {
    duration_millis: number;
    variants: TwitterVariant[];
  };
  media_url_https?: string;
}

export const twitterParser: PlatformParser = {
  name: "twitter",
  label: "Twitter / X",

  match(url: string): boolean {
    try {
      const u = new URL(url);
      return TWITTER_HOST_PATTERNS.some((p) => p.test(u.hostname));
    } catch {
      return false;
    }
  },

  async parse(url: string, config: AppConfig): Promise<VideoParseResult> {
    const parsedUrl = new URL(url);
    const pathMatch = parsedUrl.pathname.match(TWEET_PATH_PATTERN);
    if (!pathMatch) {
      throw new AppError(ErrorCodes.INVALID_URL, "Not a valid tweet URL", {
        detail: "URL must be in the format twitter.com/user/status/123456",
      });
    }
    const tweetId = pathMatch[1];

    // Try cookie-based approach first, fall back to guest token
    const cookie = config.cookies.twitter;
    const tweetData = cookie
      ? await fetchWithCookie(tweetId, cookie)
      : await fetchWithGuestToken(tweetId);

    return tweetData;
  },
};

async function fetchWithCookie(
  tweetId: string,
  cookie: string,
): Promise<VideoParseResult> {
  // Extract csrf token from cookie
  const ctMatch = cookie.match(/ct0=([^;]+)/);
  const csrfToken = ctMatch?.[1] ?? "";

  const variables = JSON.stringify({
    tweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  });

  const features = JSON.stringify({
    creator_subscriptions_tweet_preview_api_enabled: true,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
      true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_media_download_video_enabled: true,
  });

  const params = new URLSearchParams({ variables, features });
  const apiUrl = `https://x.com/i/api/graphql/xOhkmRac04YFZDOzVHpekA/TweetResultByRestId?${params}`;

  const resp = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      Cookie: cookie,
      "X-Csrf-Token": csrfToken,
      "User-Agent": DEFAULT_UA,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    throw new AppError(ErrorCodes.PARSE_FAILED, `Twitter API returned ${resp.status}`, {
      detail: `Tweet ID: ${tweetId}`,
    });
  }

  const json = await resp.json();
  return extractFromGraphQL(json, tweetId);
}

async function fetchWithGuestToken(
  tweetId: string,
): Promise<VideoParseResult> {
  // Activate guest token
  const activateResp = await fetch(
    "https://api.twitter.com/1.1/guest/activate.json",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "User-Agent": DEFAULT_UA,
      },
    },
  );

  if (!activateResp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      "Failed to obtain Twitter guest token. Configure TWITTER_COOKIE for reliable access.",
      { detail: `Status: ${activateResp.status}` },
    );
  }

  const { guest_token } = (await activateResp.json()) as {
    guest_token: string;
  };

  const variables = JSON.stringify({
    tweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  });

  const features = JSON.stringify({
    creator_subscriptions_tweet_preview_api_enabled: true,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
      true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_media_download_video_enabled: true,
  });

  const params = new URLSearchParams({ variables, features });
  const apiUrl = `https://x.com/i/api/graphql/xOhkmRac04YFZDOzVHpekA/TweetResultByRestId?${params}`;

  const resp = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      "X-Guest-Token": guest_token,
      "User-Agent": DEFAULT_UA,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Twitter API returned ${resp.status}. Guest token may be restricted — configure TWITTER_COOKIE for better reliability.`,
      { detail: `Tweet ID: ${tweetId}` },
    );
  }

  const json = await resp.json();
  return extractFromGraphQL(json, tweetId);
}

function extractFromGraphQL(json: any, tweetId: string): VideoParseResult {
  // Navigate the GraphQL response structure
  const tweetResult =
    json?.data?.tweetResult?.result ??
    json?.data?.tweet_result?.result;

  if (!tweetResult) {
    throw new AppError(ErrorCodes.VIDEO_NOT_FOUND, "Tweet not found", {
      detail: `Tweet ID: ${tweetId}`,
    });
  }

  // Handle tombstone (deleted/private tweets)
  if (tweetResult.__typename === "TweetTombstone") {
    throw new AppError(ErrorCodes.VIDEO_DELETED, "Tweet has been deleted or is not accessible");
  }

  // Unwrap "TweetWithVisibilityResults" wrapper
  const tweet = tweetResult.tweet ?? tweetResult;
  const legacy = tweet.legacy ?? tweet;
  const user = tweet.core?.user_results?.result?.legacy;

  // Find video in extended_entities
  const media: TwitterMediaEntity[] =
    legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const videoMedia = media.find((m) => m.type === "video" || m.type === "animated_gif");

  if (!videoMedia || !videoMedia.video_info) {
    throw new AppError(ErrorCodes.VIDEO_NOT_FOUND, "This tweet does not contain a video");
  }

  const { variants, duration_millis } = videoMedia.video_info;

  // Filter to MP4 variants and sort by bitrate (highest first)
  const mp4Variants = variants
    .filter((v) => v.content_type === "video/mp4" && v.bitrate !== undefined)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (mp4Variants.length === 0) {
    throw new AppError(ErrorCodes.VIDEO_NOT_FOUND, "No downloadable MP4 video found in tweet");
  }

  const title = legacy?.full_text?.split("\n")[0]?.slice(0, 100) ?? `Tweet ${tweetId}`;
  const author = user?.screen_name ?? undefined;

  return {
    platform: "twitter",
    sourceUrl: `https://x.com/i/status/${tweetId}`,
    title,
    author: author ? `@${author}` : undefined,
    coverUrl: videoMedia.media_url_https,
    duration: duration_millis ? Math.round(duration_millis / 1000) : undefined,
    watermarkStatus: "no_watermark",
    videos: mp4Variants.map((v) => {
      const qualityLabel = bitrateToQuality(v.bitrate ?? 0);
      return {
        qualityLabel,
        bitrate: v.bitrate,
        format: "mp4" as const,
        hasAudio: true,
        hasVideo: true,
        url: v.url,
      };
    }),
  };
}

function bitrateToQuality(bitrate: number): string {
  if (bitrate >= 2000000) return "720p";
  if (bitrate >= 800000) return "360p";
  if (bitrate >= 300000) return "180p";
  return `${Math.round(bitrate / 1000)}kbps`;
}
