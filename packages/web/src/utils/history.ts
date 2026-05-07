import type { Platform, VideoParseResult } from "@vd/shared";

// The __-prefixed exports below are the storage key and cap exposed for tests.
// Callers outside tests should use the public functions (listHistory, recordParse, ...).
export const __STORAGE_KEY = "vd_history_v1";
export const __MAX_ENTRIES = 500;

export interface HistoryEntry {
  id: string;
  url: string;
  platform: Platform;
  title?: string;
  author?: string;
  coverUrl?: string;
  duration?: number;
  parsedAt: number;
  downloadedAt?: number;
  lastQualityLabel?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(__STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    try {
      localStorage.setItem(__STORAGE_KEY, "[]");
    } catch {
      // ignore
    }
    return [];
  }
}

function write(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(__STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn("[history] write failed:", err);
  }
  // Notify even if setItem threw: subscribers may want to re-render based on
  // whatever listHistory() now returns (pre-failure state).
  for (const l of listeners) l();
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listHistory(): HistoryEntry[] {
  return read().slice().sort((a, b) => b.parsedAt - a.parsedAt);
}

export function recordParse(input: {
  url: string;
  result: VideoParseResult;
}): void {
  const { url, result } = input;
  const entries = read();
  const now = Date.now();
  const existing = entries.find((e) => e.url === url);

  if (existing) {
    existing.parsedAt = now;
    existing.platform = result.platform;
    existing.title = result.title;
    existing.author = result.author;
    existing.coverUrl = result.coverUrl;
    existing.duration = result.duration;
  } else {
    entries.push({
      id: genId(),
      url,
      platform: result.platform,
      title: result.title,
      author: result.author,
      coverUrl: result.coverUrl,
      duration: result.duration,
      parsedAt: now,
    });
  }

  entries.sort((a, b) => b.parsedAt - a.parsedAt);
  if (entries.length > __MAX_ENTRIES) {
    entries.length = __MAX_ENTRIES;
  }
  write(entries);
}

export function markDownloaded(url: string, qualityLabel: string): void {
  const entries = read();
  const match = entries.find((e) => e.url === url);
  if (!match) return;
  match.downloadedAt = Date.now();
  match.lastQualityLabel = qualityLabel;
  write(entries);
}

export function removeEntry(id: string): void {
  const entries = read().filter((e) => e.id !== id);
  write(entries);
}

export function clearAll(): void {
  write([]);
}

/**
 * Register a listener that fires after any mutation (in this tab or another tab).
 *
 * Note: calling subscribe() twice with the SAME function reference deduplicates
 * the in-tab path (Set semantics) but registers the cross-tab `storage` handler
 * twice. Prefer registering a given listener only once.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === __STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
