import { useState } from "react";
import { useVideoParser } from "./hooks/useVideoParser";
import { LinkInput } from "./components/LinkInput";
import { VideoInfo } from "./components/VideoInfo";
import { QualitySelector } from "./components/QualitySelector";
import { DownloadButton } from "./components/DownloadButton";
import { ErrorMessage } from "./components/ErrorMessage";
import { HistoryButton } from "./components/HistoryButton";
import { HistoryDrawer } from "./components/HistoryDrawer";

function App() {
  const { result, loading, error, parse, reset } = useVideoParser();
  const [url, setUrl] = useState("");
  const [lastParsedUrl, setLastParsedUrl] = useState<string | null>(null);
  const [selectedQuality, setSelectedQuality] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleParse = (u: string) => {
    setSelectedQuality(0);
    setLastParsedUrl(u);
    parse(u);
  };

  const handleReset = () => {
    setSelectedQuality(0);
    setLastParsedUrl(null);
    reset();
  };

  const handleHistorySelect = (u: string) => {
    setUrl(u);
    handleParse(u);
  };

  const selectedVideo = result?.videos[selectedQuality];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-16">
        <div className="mb-8 flex items-start justify-between">
          <div className="flex-1 text-center">
            <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
              Video Downloader
            </h1>
            <p className="mt-2 text-gray-500">
              Paste a video link to parse and download
            </p>
          </div>
          <div className="pt-1">
            <HistoryButton onClick={() => setHistoryOpen(true)} />
          </div>
        </div>

        <div className="mb-6">
          <LinkInput
            value={url}
            onChange={setUrl}
            onSubmit={handleParse}
            loading={loading}
            onReset={handleReset}
          />
        </div>

        {error && (
          <div className="mb-6">
            <ErrorMessage message={error} />
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-4">
            <VideoInfo result={result} />

            {result.videos.length > 0 && (
              <>
                <QualitySelector
                  videos={result.videos}
                  selectedIndex={selectedQuality}
                  onChange={setSelectedQuality}
                />

                {selectedVideo && (
                  <DownloadButton
                    video={selectedVideo}
                    title={result.title}
                    sourceUrl={lastParsedUrl ?? undefined}
                  />
                )}
              </>
            )}

            {result.videos.length === 0 && (
              <ErrorMessage message="No downloadable video found." />
            )}
          </div>
        )}

        <div className="mt-12 text-center text-xs text-gray-400">
          <p>For personal use only. Respect content creators' rights.</p>
        </div>
      </div>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={handleHistorySelect}
      />
    </div>
  );
}

export default App;
