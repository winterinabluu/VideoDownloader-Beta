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

// Current queryId — extracted from x.com production JS bundle.
// Twitter rotates these periodically; the dynamic resolver below handles rotation.
let cachedQueryId = "fHLDP3qFEjnTqhWBVvsREg";

// Feature flags required by the current TweetResultByRestId endpoint.
// Must stay in sync with x.com's client; mismatches return empty results.
const FEATURES = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: false,
  responsive_web_grok_annotations_enabled: false,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: false,
  content_disclosure_ai_generated_indicator_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: false,
  post_ctas_fetch_enabled: false,
  rweb_cashtags_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: false,
  responsive_web_grok_imagine_annotation_enabled: false,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const FIELD_TOGGLES = {
  withArticleRichContentState: false,
  withArticlePlainText: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
};

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

    const cookie = config.cookies.twitter;
    if (!cookie) {
      throw new AppError(
        ErrorCodes.PARSE_FAILED,
        "Twitter requires cookie authentication. Set the TWITTER_COOKIE environment variable with your auth_token and ct0 values.",
      );
    }

    return fetchWithCookie(tweetId, cookie);
  },
};

async function fetchWithCookie(
  tweetId: string,
  cookie: string,
): Promise<VideoParseResult> {
  const ctMatch = cookie.match(/ct0=([^;]+)/);
  const csrfToken = ctMatch?.[1] ?? "";

  const variables = JSON.stringify({
    tweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  });

  const params = new URLSearchParams({
    variables,
    features: JSON.stringify(FEATURES),
    fieldToggles: JSON.stringify(FIELD_TOGGLES),
  });

  const queryId = cachedQueryId;
  const apiUrl = `https://x.com/i/api/graphql/${queryId}/TweetResultByRestId?${params}`;

  const resp = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      Cookie: cookie,
      "X-Csrf-Token": csrfToken,
      "User-Agent": DEFAULT_UA,
      "Content-Type": "application/json",
      "X-Twitter-Active-User": "yes",
      "X-Twitter-Auth-Type": "OAuth2Session",
      "X-Twitter-Client-Language": "en",
    },
  });

  // If 404 "Query not found", the queryId has rotated — try to resolve dynamically
  if (resp.status === 404) {
    const body = await resp.text();
    if (body.includes("Query not found")) {
      const newId = await resolveQueryId();
      if (newId && newId !== queryId) {
        cachedQueryId = newId;
        return fetchWithCookie(tweetId, cookie);
      }
    }
    throw new AppError(ErrorCodes.PARSE_FAILED, `Twitter API returned 404`, {
      detail: `Tweet ID: ${tweetId}. The GraphQL queryId may have changed.`,
    });
  }

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.PARSE_FAILED,
      `Twitter API returned ${resp.status}`,
      { detail: `Tweet ID: ${tweetId}` },
    );
  }

  const json = await resp.json();
  return extractFromGraphQL(json, tweetId);
}

/**
 * Dynamically resolve the current TweetResultByRestId queryId
 * by fetching x.com's production JS bundle.
 */
async function resolveQueryId(): Promise<string | null> {
  try {
    const pageResp = await fetch("https://x.com", {
      headers: { "User-Agent": DEFAULT_UA, Accept: "text/html" },
      redirect: "follow",
    });
    const html = await pageResp.text();

    // Find the main JS bundle URL
    const jsMatch = html.match(
      /src="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[^"]+\.js)"/,
    );
    if (!jsMatch) return null;

    const jsResp = await fetch(jsMatch[1], {
      headers: { "User-Agent": DEFAULT_UA },
    });
    const js = await jsResp.text();

    // Extract queryId for TweetResultByRestId
    const idMatch = js.match(
      /queryId:"([^"]+)",operationName:"TweetResultByRestId"/,
    );
    return idMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

function extractFromGraphQL(json: any, tweetId: string): VideoParseResult {
  const tweetResult =
    json?.data?.tweetResult?.result ?? json?.data?.tweet_result?.result;

  if (!tweetResult) {
    throw new AppError(
      ErrorCodes.VIDEO_NOT_FOUND,
      "Tweet not found or not accessible. The tweet may have been deleted, or your TWITTER_COOKIE may have expired.",
      { detail: `Tweet ID: ${tweetId}` },
    );
  }

  if (tweetResult.__typename === "TweetTombstone") {
    throw new AppError(
      ErrorCodes.VIDEO_DELETED,
      "Tweet has been deleted or is not accessible",
    );
  }

  // Unwrap "TweetWithVisibilityResults" wrapper
  const tweet = tweetResult.tweet ?? tweetResult;
  const legacy = tweet.legacy ?? tweet;
  const user = tweet.core?.user_results?.result?.legacy ??
    tweet.core?.user_results?.result?.core;

  // Find video in extended_entities
  const media: TwitterMediaEntity[] =
    legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const videoMedia = media.find(
    (m) => m.type === "video" || m.type === "animated_gif",
  );

  if (!videoMedia || !videoMedia.video_info) {
    throw new AppError(
      ErrorCodes.VIDEO_NOT_FOUND,
      "This tweet does not contain a video",
    );
  }

  const { variants, duration_millis } = videoMedia.video_info;

  // Filter to MP4 variants and sort by bitrate (highest first)
  const mp4Variants = variants
    .filter((v) => v.content_type === "video/mp4" && v.bitrate !== undefined)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (mp4Variants.length === 0) {
    throw new AppError(
      ErrorCodes.VIDEO_NOT_FOUND,
      "No downloadable MP4 video found in tweet",
    );
  }

  const title =
    legacy?.full_text?.split("\n")[0]?.slice(0, 100) ?? `Tweet ${tweetId}`;
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
      const qualityLabel = resolveQualityLabel(v.url, v.bitrate ?? 0);
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

/**
 * Extract quality label from the video URL's resolution path segment,
 * falling back to a bitrate-based estimate.
 * Twitter URLs look like: .../vid/avc1/2400x2160/xxx.mp4
 */
function resolveQualityLabel(url: string, bitrate: number): string {
  const resMatch = url.match(/\/(\d+)x(\d+)\//);
  if (resMatch) {
    const height = parseInt(resMatch[2], 10);
    return `${height}p`;
  }
  // Fallback: estimate from bitrate
  if (bitrate >= 10000000) return "2160p";
  if (bitrate >= 4000000) return "1080p";
  if (bitrate >= 2000000) return "720p";
  if (bitrate >= 800000) return "360p";
  if (bitrate >= 300000) return "180p";
  return `${Math.round(bitrate / 1000)}kbps`;
}
