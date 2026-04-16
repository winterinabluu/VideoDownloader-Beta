import { useState } from "react";

interface LinkInputProps {
  onSubmit: (url: string) => void;
  loading: boolean;
  onReset: () => void;
}

export function LinkInput({ onSubmit, loading, onReset }: LinkInputProps) {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  const handleClear = () => {
    setUrl("");
    onReset();
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste video link here..."
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base
                       outline-none transition-colors
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                       disabled:bg-gray-100"
            disabled={loading}
          />
          {url && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
                         hover:text-gray-600 text-lg leading-none"
              aria-label="Clear input"
            >
              &times;
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="rounded-lg bg-blue-600 px-6 py-3 text-base font-medium text-white
                     transition-colors hover:bg-blue-700
                     disabled:cursor-not-allowed disabled:opacity-50
                     sm:w-auto w-full"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  className="opacity-25"
                />
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  className="opacity-75"
                />
              </svg>
              Parsing...
            </span>
          ) : (
            "Parse"
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Supports: Twitter/X, Xiaohongshu, Bilibili, YouTube, Weibo, Douyin
      </p>
    </form>
  );
}
