# History Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-local history drawer that lists recently parsed videos, distinguishes downloaded from just-parsed, and lets users re-parse with one click.

**Architecture:** Pure storage module (`utils/history.ts`) backed by `localStorage`, consumed via a `useSyncExternalStore` hook (`useHistory`), rendered by three new components (`HistoryButton` / `HistoryDrawer` / `HistoryItem`). URL state is lifted from `LinkInput` to `App` to support re-parse-from-history. No backend changes.

**Tech Stack:** React 18 · TypeScript · Tailwind · vitest + jsdom (new dev dep) · native `localStorage`

**Spec:** `docs/superpowers/specs/2026-05-07-history-feature-design.md`

---

## File Map

**Create:**
- `packages/web/src/utils/history.ts` — pure storage API
- `packages/web/src/hooks/useHistory.ts` — React subscription hook
- `packages/web/src/components/HistoryButton.tsx` — header trigger
- `packages/web/src/components/HistoryDrawer.tsx` — side panel shell
- `packages/web/src/components/HistoryItem.tsx` — list row
- `packages/web/tests/history.test.ts` — unit tests
- `packages/web/vitest.config.ts` — test config (jsdom)

**Modify:**
- `packages/web/package.json` — add vitest + jsdom + test scripts
- `packages/web/src/App.tsx` — wire url state, history button, drawer, callbacks
- `packages/web/src/components/LinkInput.tsx` — become controlled (`value`/`onChange` props)
- `packages/web/src/components/DownloadButton.tsx` — accept `url`, call `markDownloaded` on click
- `packages/web/src/hooks/useVideoParser.ts` — call `recordParse` on success

---

## Task 1: Set up vitest in the web package

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`

- [ ] **Step 1: Add devDependencies and test scripts**

Edit `packages/web/package.json`. Merge into `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Merge into `devDependencies`:

```json
"vitest": "^2.1.0",
"jsdom": "^25.0.0"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: adds `vitest` and `jsdom`, no errors.

- [ ] **Step 3: Create vitest config**

Write `packages/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
  },
});
```

- [ ] **Step 4: Sanity-check vitest runs**

Run: `pnpm --filter @vd/web test`
Expected: exits 0 with message like `No test files found` (include pattern matches nothing yet).

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json packages/web/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(web): add vitest + jsdom for unit tests"
```

---

## Task 2: Storage module `utils/history.ts` (strict TDD)

**Files:**
- Create: `packages/web/tests/history.test.ts`
- Create: `packages/web/src/utils/history.ts`

- [ ] **Step 1: Write the failing tests**

Write `packages/web/tests/history.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoParseResult } from "@vd/shared";
import {
  clearAll,
  listHistory,
  markDownloaded,
  recordParse,
  removeEntry,
  subscribe,
  __STORAGE_KEY,
  __MAX_ENTRIES,
} from "../src/utils/history";

function fakeResult(over: Partial<VideoParseResult> = {}): VideoParseResult {
  return {
    platform: "douyin",
    sourceUrl: "https://www.iesdouyin.com/share/video/1/",
    title: "Title",
    author: "Someone",
    coverUrl: "https://cdn.example.com/cover.jpg",
    duration: 60,
    watermarkStatus: "no_watermark",
    videos: [
      { qualityLabel: "720p", format: "mp4", url: "/api/download?token=x" },
    ],
    ...over,
  };
}

describe("history storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("listHistory returns [] when empty", () => {
    expect(listHistory()).toEqual([]);
  });

  it("recordParse inserts a new entry", () => {
    recordParse({ url: "https://v.douyin.com/a", result: fakeResult() });
    const list = listHistory();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      url: "https://v.douyin.com/a",
      platform: "douyin",
      title: "Title",
      author: "Someone",
    });
    expect(list[0].id).toBeTruthy();
    expect(list[0].parsedAt).toBeGreaterThan(0);
    expect(list[0].downloadedAt).toBeUndefined();
  });

  it("listHistory returns entries sorted by parsedAt DESC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    recordParse({ url: "https://a", result: fakeResult({ title: "A" }) });
    vi.setSystemTime(new Date("2026-05-02T00:00:00Z"));
    recordParse({ url: "https://b", result: fakeResult({ title: "B" }) });
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));
    recordParse({ url: "https://c", result: fakeResult({ title: "C" }) });
    const titles = listHistory().map((e) => e.title);
    expect(titles).toEqual(["C", "B", "A"]);
  });

  it("recordParse deduplicates by URL and bumps to top", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    recordParse({ url: "https://a", result: fakeResult({ title: "A-old" }) });
    vi.setSystemTime(new Date("2026-05-02T00:00:00Z"));
    recordParse({ url: "https://b", result: fakeResult({ title: "B" }) });
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));
    recordParse({ url: "https://a", result: fakeResult({ title: "A-new" }) });

    const list = listHistory();
    expect(list).toHaveLength(2);
    expect(list[0].url).toBe("https://a");
    expect(list[0].title).toBe("A-new");
    expect(list[1].url).toBe("https://b");
  });

  it("recordParse truncates at MAX_ENTRIES", () => {
    for (let i = 0; i < __MAX_ENTRIES + 10; i++) {
      recordParse({
        url: `https://example.com/${i}`,
        result: fakeResult({ title: `T${i}` }),
      });
    }
    expect(listHistory()).toHaveLength(__MAX_ENTRIES);
  });

  it("markDownloaded sets downloadedAt and lastQualityLabel", () => {
    recordParse({ url: "https://a", result: fakeResult() });
    markDownloaded("https://a", "1080p");
    const [entry] = listHistory();
    expect(entry.downloadedAt).toBeGreaterThan(0);
    expect(entry.lastQualityLabel).toBe("1080p");
  });

  it("markDownloaded on unknown URL is a no-op", () => {
    recordParse({ url: "https://a", result: fakeResult() });
    markDownloaded("https://nope", "720p");
    const [entry] = listHistory();
    expect(entry.downloadedAt).toBeUndefined();
    expect(entry.lastQualityLabel).toBeUndefined();
  });

  it("removeEntry removes the matching id", () => {
    recordParse({ url: "https://a", result: fakeResult({ title: "A" }) });
    recordParse({ url: "https://b", result: fakeResult({ title: "B" }) });
    const [first] = listHistory();
    removeEntry(first.id);
    const remaining = listHistory();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(first.id);
  });

  it("clearAll empties the store", () => {
    recordParse({ url: "https://a", result: fakeResult() });
    recordParse({ url: "https://b", result: fakeResult() });
    clearAll();
    expect(listHistory()).toEqual([]);
  });

  it("recovers from corrupt JSON by returning [] and overwriting", () => {
    localStorage.setItem(__STORAGE_KEY, "{not json");
    expect(listHistory()).toEqual([]);
    expect(localStorage.getItem(__STORAGE_KEY)).toBe("[]");
  });

  it("subscribe fires after mutations", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    recordParse({ url: "https://a", result: fakeResult() });
    markDownloaded("https://a", "720p");
    removeEntry(listHistory()[0].id);
    clearAll();
    expect(fn).toHaveBeenCalledTimes(4);
    unsub();
    recordParse({ url: "https://b", result: fakeResult() });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("swallows write failures without throwing", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });
    expect(() =>
      recordParse({ url: "https://a", result: fakeResult() }),
    ).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @vd/web test`
Expected: all tests fail because `../src/utils/history` does not exist.

- [ ] **Step 3: Implement the module**

Write `packages/web/src/utils/history.ts`:

```ts
import type { Platform, VideoParseResult } from "@vd/shared";

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
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `pnpm --filter @vd/web test`
Expected: all history tests pass (11 green).

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @vd/web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/utils/history.ts packages/web/tests/history.test.ts
git commit -m "feat(web): add localStorage-backed history module"
```

---

## Task 3: `useHistory` React hook

**Files:**
- Create: `packages/web/src/hooks/useHistory.ts`

- [ ] **Step 1: Write the hook**

Write `packages/web/src/hooks/useHistory.ts`:

```ts
import { useSyncExternalStore } from "react";
import {
  clearAll as clearAllImpl,
  listHistory,
  removeEntry as removeEntryImpl,
  subscribe,
  type HistoryEntry,
} from "../utils/history";

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  removeEntry: (id: string) => void;
  clearAll: () => void;
}

function getSnapshot(): HistoryEntry[] {
  return listHistory();
}

export function useHistory(): UseHistoryReturn {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    entries,
    removeEntry: removeEntryImpl,
    clearAll: clearAllImpl,
  };
}
```

Note: `listHistory()` allocates a new array on each call (it does `.slice().sort()`), so the referential identity changes on every mutation — that's what tells React to re-render. It also means the snapshot is stable between mutations because nothing else triggers a resubscribe.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @vd/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/useHistory.ts
git commit -m "feat(web): add useHistory hook via useSyncExternalStore"
```

---

## Task 4: Lift URL state from `LinkInput` to `App`

This refactor is the prerequisite for re-parse-on-click. No new features yet — after this task the app behaves identically.

**Files:**
- Modify: `packages/web/src/components/LinkInput.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Make `LinkInput` controlled**

Replace `packages/web/src/components/LinkInput.tsx` entirely with:

```tsx
interface LinkInputProps {
  value: string;
  onChange: (url: string) => void;
  onSubmit: (url: string) => void;
  loading: boolean;
  onReset: () => void;
}

export function LinkInput({
  value,
  onChange,
  onSubmit,
  loading,
  onReset,
}: LinkInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  const handleClear = () => {
    onChange("");
    onReset();
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste video link here..."
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base
                       outline-none transition-colors
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                       disabled:bg-gray-100"
            disabled={loading}
          />
          {value && (
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
          disabled={loading || !value.trim()}
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
```

- [ ] **Step 2: Update `App.tsx` to own URL state**

Replace `packages/web/src/App.tsx`'s body with:

```tsx
import { useState } from "react";
import { useVideoParser } from "./hooks/useVideoParser";
import { LinkInput } from "./components/LinkInput";
import { VideoInfo } from "./components/VideoInfo";
import { QualitySelector } from "./components/QualitySelector";
import { DownloadButton } from "./components/DownloadButton";
import { ErrorMessage } from "./components/ErrorMessage";

function App() {
  const { result, loading, error, parse, reset } = useVideoParser();
  const [url, setUrl] = useState("");
  const [selectedQuality, setSelectedQuality] = useState(0);

  const handleParse = (u: string) => {
    setSelectedQuality(0);
    parse(u);
  };

  const handleReset = () => {
    setSelectedQuality(0);
    reset();
  };

  const selectedVideo = result?.videos[selectedQuality];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-16">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            Video Downloader
          </h1>
          <p className="mt-2 text-gray-500">
            Paste a video link to parse and download
          </p>
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
    </div>
  );
}

export default App;
```

- [ ] **Step 3: Type-check and smoke-test**

Run: `pnpm --filter @vd/web lint`
Expected: no errors.

Manually: dev server (already running) should hot-reload; parsing a link still works exactly as before.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/LinkInput.tsx packages/web/src/App.tsx
git commit -m "refactor(web): lift url state from LinkInput to App"
```

---

## Task 5: `HistoryItem` component

**Files:**
- Create: `packages/web/src/components/HistoryItem.tsx`

- [ ] **Step 1: Write the component**

Write `packages/web/src/components/HistoryItem.tsx`:

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @vd/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/HistoryItem.tsx
git commit -m "feat(web): add HistoryItem component"
```

---

## Task 6: `HistoryDrawer` component

**Files:**
- Create: `packages/web/src/components/HistoryDrawer.tsx`

- [ ] **Step 1: Write the component**

Write `packages/web/src/components/HistoryDrawer.tsx`:

```tsx
import { useEffect } from "react";
import { useHistory } from "../hooks/useHistory";
import { HistoryItem } from "./HistoryItem";

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

export function HistoryDrawer({ open, onClose, onSelect }: HistoryDrawerProps) {
  const { entries, removeEntry, clearAll } = useHistory();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleClear = () => {
    if (entries.length === 0) return;
    if (window.confirm(`确定清空全部 ${entries.length} 条历史？`)) {
      clearAll();
    }
  };

  const handleSelect = (url: string) => {
    onSelect(url);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity
                    ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />

      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-sm
                    flex-col bg-white shadow-xl transition-transform
                    ${open ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b
                           border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            History <span className="text-gray-400">({entries.length})</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8
                            text-center text-sm text-gray-400">
              还没有历史记录
            </div>
          ) : (
            <ul>
              {entries.map((e) => (
                <HistoryItem
                  key={e.id}
                  entry={e}
                  onClick={handleSelect}
                  onDelete={removeEntry}
                />
              ))}
            </ul>
          )}
        </div>

        {entries.length > 0 && (
          <footer className="border-t border-gray-200 p-3">
            <button
              onClick={handleClear}
              className="w-full rounded-md border border-gray-200 px-3 py-2
                         text-sm text-gray-600 hover:bg-gray-50"
            >
              清空全部
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @vd/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/HistoryDrawer.tsx
git commit -m "feat(web): add HistoryDrawer side panel"
```

---

## Task 7: `HistoryButton` component

**Files:**
- Create: `packages/web/src/components/HistoryButton.tsx`

- [ ] **Step 1: Write the component**

Write `packages/web/src/components/HistoryButton.tsx`:

```tsx
import { useHistory } from "../hooks/useHistory";

interface HistoryButtonProps {
  onClick: () => void;
}

export function HistoryButton({ onClick }: HistoryButtonProps) {
  const { entries } = useHistory();
  const count = entries.length;

  return (
    <button
      onClick={onClick}
      aria-label="Show history"
      className="relative inline-flex items-center gap-1.5 rounded-md border
                 border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700
                 shadow-sm hover:bg-gray-50"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      History
      {count > 0 && (
        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px]
                         font-semibold text-blue-700">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @vd/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/HistoryButton.tsx
git commit -m "feat(web): add HistoryButton with count badge"
```

---

## Task 8: Wire history into `App`, `useVideoParser`, `DownloadButton`

**Files:**
- Modify: `packages/web/src/hooks/useVideoParser.ts`
- Modify: `packages/web/src/components/DownloadButton.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Record parse on success**

Replace `packages/web/src/hooks/useVideoParser.ts` entirely with:

```ts
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
```

- [ ] **Step 2: DownloadButton calls markDownloaded**

Replace `packages/web/src/components/DownloadButton.tsx` entirely with:

```tsx
import type { VideoVariant } from "@vd/shared";
import { downloadFile, isMobile } from "../utils/download";
import { markDownloaded } from "../utils/history";

interface DownloadButtonProps {
  video: VideoVariant;
  title?: string;
  sourceUrl?: string;
}

export function DownloadButton({ video, title, sourceUrl }: DownloadButtonProps) {
  const filename = title
    ? `${title}_${video.qualityLabel}`
    : `video_${video.qualityLabel}`;

  const handleClick = () => {
    if (sourceUrl) {
      markDownloaded(sourceUrl, video.qualityLabel);
    }
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
```

`sourceUrl` is the user-input URL (what we dedupe history by), NOT `result.sourceUrl` (which is the platform's normalized page URL). We thread the former through from App.

- [ ] **Step 3: Final `App.tsx` with button + drawer + sourceUrl threading**

Replace `packages/web/src/App.tsx` entirely with:

```tsx
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
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @vd/web lint`
Expected: no errors.

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @vd/web test`
Expected: 11 history tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/hooks/useVideoParser.ts \
        packages/web/src/components/DownloadButton.tsx \
        packages/web/src/App.tsx
git commit -m "feat(web): wire history drawer into parse + download flow"
```

---

## Task 9: Manual QA and final push

- [ ] **Step 1: Run both unit suites**

Run: `pnpm -r run test`
Expected: server tests + web tests all pass.

- [ ] **Step 2: Dev server smoke**

Dev server should still be running (`pnpm dev` from root). If not: `pnpm dev`.

Verify in browser at http://localhost:5173/:

1. Parse 3 different links (e.g. one douyin + one bilibili + one twitter).
2. Click the "History" button → drawer slides in, shows 3 entries newest-first.
3. Click one of the entries → URL prefills, parse fires, drawer closes, same entry moves to top.
4. Parse the same URL again directly → still no duplicate row.
5. Click Download on a variant → reopen drawer → that entry has "已下载 · 720p" pill.
6. Click × on an entry → it disappears.
7. Click "清空全部" → confirm dialog → all entries gone, empty state shows.
8. Reload the page → previously-added entries persist (if you didn't clear).
9. Open a second tab, parse a video there → first tab's drawer count updates.
10. Press ESC while drawer is open → drawer closes.

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Report to user**

Summarize: "History feature shipped — N commits on main. QA checklist completed. Ask user to smoke-test in their browser."

---

## Self-Review Checklist

Already done by author:
- ✅ Spec coverage: data model (T2), storage API (T2), useHistory (T3), URL lift (T4), 3 components (T5-7), wiring (T8), tests (T2), manual QA (T9).
- ✅ No placeholders: every code step has complete code.
- ✅ Type consistency: `HistoryEntry` used identically across T2/T3/T5/T6; `recordParse`/`markDownloaded` signatures match across module, hook consumer, and component; `sourceUrl` prop on DownloadButton lines up with App threading `lastParsedUrl`.
- ✅ Test runner set up before tests are written (T1 before T2).
- ✅ Refactor (T4) is its own task, no feature change, so a regression can bisect cleanly.
