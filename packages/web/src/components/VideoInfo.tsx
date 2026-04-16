import type { VideoParseResult } from "@vd/shared";

interface VideoInfoProps {
  result: VideoParseResult;
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "Twitter / X",
  xiaohongshu: "Xiaohongshu",
  bilibili: "Bilibili",
  youtube: "YouTube",
  weibo: "Weibo",
  douyin: "Douyin",
};

const WATERMARK_LABELS: Record<string, string> = {
  no_watermark: "No watermark",
  watermarked: "Has watermark",
  unknown: "Unknown",
  not_supported: "Watermark removal not supported",
};

export function VideoInfo({ result }: VideoInfoProps) {
  const platformLabel = PLATFORM_LABELS[result.platform] ?? result.platform;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row">
        {result.coverUrl && (
          <div className="flex-shrink-0">
            <img
              src={result.coverUrl}
              alt="Video cover"
              className="h-auto w-full rounded-md object-cover sm:h-32 sm:w-56"
              loading="lazy"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
              {platformLabel}
            </span>
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                result.watermarkStatus === "no_watermark"
                  ? "bg-green-100 text-green-800"
                  : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {WATERMARK_LABELS[result.watermarkStatus]}
            </span>
          </div>

          {result.title && (
            <h3 className="mb-1 text-base font-semibold text-gray-900 line-clamp-2">
              {result.title}
            </h3>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
            {result.author && <span>Author: {result.author}</span>}
            {result.duration != null && (
              <span>Duration: {formatDuration(result.duration)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
