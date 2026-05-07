import { useState } from "react";
import type { HistoryEntry } from "../utils/history";

interface HistoryItemProps {
  entry: HistoryEntry;
  onClick: (url: string) => void;
  onDelete: (id: string) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "X",
  xiaohongshu: "小红书",
  bilibili: "B 站",
  youtube: "YouTube",
  weibo: "微博",
  douyin: "抖音",
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function HistoryItem({ entry, onClick, onDelete }: HistoryItemProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const showCover = entry.coverUrl && !coverFailed;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(entry.id);
  };

  return (
    <li
      onClick={() => onClick(entry.url)}
      className="group flex cursor-pointer gap-3 border-b border-gray-100 p-3
                 hover:bg-gray-50"
    >
      <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded
                      bg-gray-200">
        {showCover ? (
          <img
            src={entry.coverUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center
                          text-xs font-medium text-gray-400">
            {PLATFORM_LABELS[entry.platform] ?? entry.platform}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">
            {PLATFORM_LABELS[entry.platform] ?? entry.platform}
          </span>
          {entry.downloadedAt && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px]
                             font-medium text-green-700">
              已下载{entry.lastQualityLabel ? ` · ${entry.lastQualityLabel}` : ""}
            </span>
          )}
        </div>
        <p className="truncate text-sm font-medium text-gray-900">
          {entry.title || entry.url}
        </p>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {entry.author && <span className="truncate">{entry.author}</span>}
          <span>·</span>
          <span>{relativeTime(entry.parsedAt)}</span>
        </div>
      </div>
      <button
        onClick={handleDelete}
        aria-label="Delete entry"
        className="flex-shrink-0 text-gray-300 opacity-0 transition-opacity
                   hover:text-gray-600 group-hover:opacity-100"
      >
        ×
      </button>
    </li>
  );
}
