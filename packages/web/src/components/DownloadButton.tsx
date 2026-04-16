import type { VideoVariant } from "@vd/shared";
import { downloadFile, isMobile } from "../utils/download";

interface DownloadButtonProps {
  video: VideoVariant;
  title?: string;
}

export function DownloadButton({ video, title }: DownloadButtonProps) {
  const filename = title
    ? `${title}_${video.qualityLabel}`
    : `video_${video.qualityLabel}`;

  const handleClick = () => {
    downloadFile(video.url, filename);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        className="w-full rounded-lg bg-green-600 px-6 py-3 text-base font-medium
                   text-white transition-colors hover:bg-green-700
                   sm:w-auto"
      >
        Download {video.qualityLabel}
      </button>
      {isMobile() && (
        <p className="text-xs text-gray-500">
          If the video doesn't save automatically, long-press on the video in the
          new page, then select "Save Video" or use the share button to save.
        </p>
      )}
    </div>
  );
}
