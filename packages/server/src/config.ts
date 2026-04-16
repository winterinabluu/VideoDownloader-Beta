export interface AppConfig {
  port: number;
  nodeEnv: string;
  frontendUrl: string;
  downloadCacheTtlSeconds: number;
  maxDownloadSizeMb: number;
  ytdlpPath: string;
  ffmpegPath: string;
  cookies: {
    youtube?: string;
    bilibili?: string;
    twitter?: string;
    weibo?: string;
    douyin?: string;
    xiaohongshu?: string;
  };
}

function envOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function envOrUndefined(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

function buildConfig(): AppConfig {
  return {
    port: parseInt(envOrDefault("PORT", "3000"), 10),
    nodeEnv: envOrDefault("NODE_ENV", "development"),
    frontendUrl: envOrDefault("FRONTEND_URL", "http://localhost:5173"),
    downloadCacheTtlSeconds: parseInt(
      envOrDefault("DOWNLOAD_CACHE_TTL_SECONDS", "600"),
      10,
    ),
    maxDownloadSizeMb: parseInt(
      envOrDefault("MAX_DOWNLOAD_SIZE_MB", "2048"),
      10,
    ),
    ytdlpPath: envOrDefault("YTDLP_PATH", "yt-dlp"),
    ffmpegPath: envOrDefault("FFMPEG_PATH", "ffmpeg"),
    cookies: {
      youtube: envOrUndefined("YOUTUBE_COOKIES"),
      bilibili: envOrUndefined("BILIBILI_COOKIE"),
      twitter: envOrUndefined("TWITTER_COOKIE"),
      weibo: envOrUndefined("WEIBO_COOKIE"),
      douyin: envOrUndefined("DOUYIN_COOKIE"),
      xiaohongshu: envOrUndefined("XIAOHONGSHU_COOKIE"),
    },
  };
}

/** Lazily initialized config — reads env vars on first access, after dotenv has loaded */
let _config: AppConfig | null = null;

export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop) {
    if (!_config) _config = buildConfig();
    return _config[prop as keyof AppConfig];
  },
});
