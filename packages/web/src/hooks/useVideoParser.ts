import { useState, useCallback } from "react";
import type { VideoParseResult } from "@vd/shared";
import { parseVideo } from "../utils/api";
import { recordParse } from "../utils/history";

interface UseVideoParserReturn {
  result: VideoParseResult | null;
  loading: boolean;
  error: string | null;
  parse: (url: string) => Promise<void>;
  reset: () => void;
}

export function useVideoParser(): UseVideoParserReturn {
  const [result, setResult] = useState<VideoParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const resp = await parseVideo(url);
      if (resp.ok) {
        setResult(resp.data);
        recordParse({ url, result: resp.data });
      } else {
        setError(resp.error.message);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error, please try again",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return { result, loading, error, parse, reset };
}
