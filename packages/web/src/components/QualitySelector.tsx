import type { VideoVariant } from "@vd/shared";

interface QualitySelectorProps {
  videos: VideoVariant[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

export function QualitySelector({
  videos,
  selectedIndex,
  onChange,
}: QualitySelectorProps) {
  if (videos.length <= 1) return null;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-700">
        Select quality:
      </label>
      <div className="flex flex-wrap gap-2">
        {videos.map((v, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              i === selectedIndex
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {v.qualityLabel}
            {v.isWatermarked === false && (
              <span className="ml-1 text-green-600 text-xs">(clean)</span>
            )}
            {v.isWatermarked === true && (
              <span className="ml-1 text-yellow-600 text-xs">(watermark)</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
