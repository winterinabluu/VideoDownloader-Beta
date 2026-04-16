import { useState } from "react";
import { useVideoParser } from "./hooks/useVideoParser";
import { LinkInput } from "./components/LinkInput";
import { VideoInfo } from "./components/VideoInfo";
import { QualitySelector } from "./components/QualitySelector";
import { DownloadButton } from "./components/DownloadButton";
import { ErrorMessage } from "./components/ErrorMessage";

function App() {
  const { result, loading, error, parse, reset } = useVideoParser();
  const [selectedQuality, setSelectedQuality] = useState(0);

  const handleParse = (url: string) => {
    setSelectedQuality(0);
    parse(url);
  };

  const handleReset = () => {
    setSelectedQuality(0);
    reset();
  };

  const selectedVideo = result?.videos[selectedQuality];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            Video Downloader
          </h1>
          <p className="mt-2 text-gray-500">
            Paste a video link to parse and download
          </p>
        </div>

        {/* Input */}
        <div className="mb-6">
          <LinkInput
            onSubmit={handleParse}
            loading={loading}
            onReset={handleReset}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6">
            <ErrorMessage message={error} />
          </div>
        )}

        {/* Results */}
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
                  />
                )}
              </>
            )}

            {result.videos.length === 0 && (
              <ErrorMessage message="No downloadable video found." />
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-gray-400">
          <p>For personal use only. Respect content creators' rights.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
