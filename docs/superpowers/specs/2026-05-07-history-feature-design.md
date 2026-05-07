# History Feature — Design Spec

**Date:** 2026-05-07
**Status:** Approved, ready for implementation plan

## Problem

The video-downloader has no way to revisit previously parsed videos. A user who parsed a link yesterday and wants to download it again must find the original URL, paste it, and parse from scratch. There's no record of "what have I downloaded recently."

## Goals

- Show a chronological list of recently parsed videos.
- Distinguish "parsed only" from "actually downloaded".
- Let the user re-parse a previous link with one click (which also bumps it to the top).
- Single-page-app, single-user, no server changes.

## Non-Goals

- Multi-device sync.
- Cross-user history or accounts.
- Persistent download artifacts (we still proxy-stream, no server-side storage).
- Search / filter UI (list is short enough; revisit if it grows).

## Architecture Overview

Three layers, all in `packages/web`:

```
HistoryDrawer / HistoryItem / HistoryButton  ←── UI (presentational)
                  ↓
            useHistory()                     ←── React hook (subscription)
                  ↓
            utils/history.ts                 ←── Pure storage module
                  ↓
              localStorage                   ←── Browser persistence
```

Storage is browser-local. No backend changes. The existing `useVideoParser` hook gains one side-effect call to record successful parses; the existing `<DownloadButton>` gains one to mark downloads.

## §1 Data Model

```ts
interface HistoryEntry {
  id: string;                 // crypto.randomUUID()
  url: string;                // user's original input (short link kept verbatim)
  platform: Platform;         // from VideoParseResult
  title?: string;
  author?: string;
  coverUrl?: string;          // snapshot at parse time; may expire later
  duration?: number;          // seconds
  parsedAt: number;           // epoch ms — also serves as sort key
  downloadedAt?: number;      // epoch ms — presence == "downloaded"
  lastQualityLabel?: string;  // last quality the user clicked download on
}
```

`parsedAt` doubles as the sort key. `downloadedAt` doubles as the "has been downloaded" flag — no separate boolean.

## §2 Storage Module (`packages/web/src/utils/history.ts`)

### Public API

```ts
listHistory(): HistoryEntry[]
recordParse(input: { url: string; result: VideoParseResult }): void
markDownloaded(url: string, qualityLabel: string): void
removeEntry(id: string): void
clearAll(): void
subscribe(listener: () => void): () => void   // for useSyncExternalStore
```

### Constants

- `STORAGE_KEY = "vd_history_v1"` — version suffix lets us migrate later.
- `MAX_ENTRIES = 500`.

### Behavior contract

| Operation | Detail |
|-----------|--------|
| Read path | `JSON.parse` wrapped in `try/catch`. On parse failure, treat as empty AND write back a clean `[]` so we don't keep retrying corrupted data. Always returned sorted by `parsedAt DESC`. |
| `recordParse` | Look up existing entry by `url`. If hit: update `parsedAt = Date.now()`, refresh `title/author/coverUrl/duration` from the new result (newer parse may have better data). If miss: insert new entry with fresh `id`. Then truncate to `MAX_ENTRIES`. |
| `markDownloaded` | Find entry by `url`. If found: write `downloadedAt = Date.now()` and `lastQualityLabel`. If not found (edge case — shouldn't happen since download follows a parse): no-op. |
| `removeEntry` / `clearAll` | Straightforward. |
| Notification | After every mutation, write to localStorage AND call all subscribers. The native `storage` event only fires across tabs, not within the same tab — we trigger our own subscribers manually. |
| Cross-tab sync | `subscribe` also installs a `window.addEventListener("storage", ...)` listener filtered on our key, calling subscribers when another tab mutates the store. |
| Write failure | localStorage can throw (quota, private mode). Catch and `console.warn`; do NOT rethrow. History is auxiliary — must not break the main flow. |

### Why pure functions, not a class

Easier to test (no state to mock), easier to consume from a hook with `useSyncExternalStore`, no instance lifecycle to manage in React.

## §3 React Integration

### `packages/web/src/hooks/useHistory.ts`

```ts
function useHistory(): {
  entries: HistoryEntry[];
  removeEntry: (id: string) => void;
  clearAll: () => void;
};
```

Internally: `useSyncExternalStore(subscribe, listHistory, listHistory)`. This is React 18's correct primitive for external stores — handles tearing, concurrent mode, and SSR-snapshot semantics. (We're CSR-only but the API is still the right tool.)

### Wiring into existing components

- **`useVideoParser.parse()`**: after `setResult(resp.data)` succeeds, call `recordParse({ url, result: resp.data })`. URL is the user's original input, threaded through.
- **`<DownloadButton>`**: on click (the same handler that triggers download), call `markDownloaded(url, video.qualityLabel)`. Need to thread `url` through props from `App.tsx`.
- **`<App>`**: holds `historyOpen` state, renders `<HistoryButton onClick={...}>` in the header and `<HistoryDrawer open={historyOpen} onClose={...}>` always-mounted.
- **URL state lifting**: Currently `LinkInput` owns `url` as local `useState`. Lift it to `App.tsx` and make `LinkInput` controlled via `value` + `onChange` props (keep the submit/clear semantics intact). This is the prerequisite for history-item-click → prefill + parse.
- **Re-parse from history**: clicking a `<HistoryItem>` calls `(url) => { setUrl(url); parse(url); setHistoryOpen(false); }` passed down as a prop.

## §4 UI Components

### `<HistoryButton />`
Header button, top-right. Shows clock icon + count badge when entries exist (e.g. "12"). Click toggles drawer.

### `<HistoryDrawer />`
- Right-aligned panel, ~360px wide on desktop, full-width on mobile.
- Slides in via Tailwind `transition-transform translate-x-full → translate-x-0`, backdrop fades in.
- Closes on: backdrop click, ESC key, button click.
- Header: "History (N)" + close button.
- Body: scrollable list of `<HistoryItem>`, or empty state "还没有历史记录" + small icon.
- Footer: "清空全部" button (with browser `confirm()` dialog).

### `<HistoryItem />`
Single row, ~80px tall:
- Left: 64×40 thumbnail (cover URL with `onError` fallback to platform logo).
- Center: title (1 line, truncate) / author + relative time ("2h ago") / platform tag.
- Right: small "已下载" pill if `downloadedAt`, hover-revealed delete (×) button.
- Whole row clickable → triggers re-parse.

No new dependencies. No virtualization (500 max rows is fine).

## §5 Error Handling & Edge Cases

| Case | Handling |
|------|----------|
| localStorage write fails (quota / privacy mode) | `try/catch`, `console.warn`, swallow. Main flow unaffected. |
| localStorage contains corrupt JSON | Treat as empty, immediately overwrite with `[]`. |
| Cover URL expired (signed CDN URL → 403/404 later) | `<img onError>` swaps in a platform logo SVG. |
| Same URL re-parsed | `recordParse` dedupes: bumps `parsedAt`, refreshes metadata, no duplicate row. |
| `clearAll` clicked accidentally | `window.confirm("确定清空全部 N 条历史？")` before executing. |
| User downloads, then comes back days later — token expired | Clicking the history row re-parses to get a fresh download token; we never store the token itself. |
| Two browser tabs open | `storage` event listener keeps both drawers in sync. |

## §6 Testing

### Unit (vitest — new dep for the web package)

The web package does not currently have a test runner. Add as devDependencies: `vitest`, `jsdom` (or `@testing-library/jsdom`), and set `test: "vitest run"` / `test:watch` scripts in `packages/web/package.json`. vitest config: `environment: "jsdom"`. Existing `packages/server` already uses vitest, so the tooling is familiar.

Add `packages/web/tests/history.test.ts`:

- `listHistory` returns sorted desc.
- `recordParse` inserts new entry.
- `recordParse` deduplicates by URL and bumps timestamp.
- `recordParse` truncates at `MAX_ENTRIES`.
- `markDownloaded` sets `downloadedAt` and `lastQualityLabel`.
- `markDownloaded` on unknown URL is a no-op.
- `removeEntry` removes the matching id.
- `clearAll` empties the store.
- Corrupt JSON in storage is recovered to `[]`.
- Subscribers fire after every mutation.

vitest's jsdom environment provides `localStorage`. No mocks needed.

### Manual (per user preference: nothing claimed done until user-tested)

- Parse 3 different platform URLs → drawer shows 3 entries, newest on top.
- Re-parse the same URL → still 3 entries, that one moves to top.
- Click an item → URL prefills, parse fires, entry bumped.
- Download a video → "已下载" badge + quality label appear on that entry.
- Reload page → entries persist.
- Open second tab, parse a video there → first tab's drawer updates.

## File Plan

New files:
- `packages/web/src/utils/history.ts`
- `packages/web/src/hooks/useHistory.ts`
- `packages/web/src/components/HistoryButton.tsx`
- `packages/web/src/components/HistoryDrawer.tsx`
- `packages/web/src/components/HistoryItem.tsx`
- `packages/web/tests/history.test.ts` (+ `vitest.config.ts` if not present)

Modified files:
- `packages/web/src/App.tsx` — wire button + drawer + URL prefill.
- `packages/web/src/hooks/useVideoParser.ts` — call `recordParse` on success.
- `packages/web/src/components/DownloadButton.tsx` — call `markDownloaded` on click; accept `url` prop.
- `packages/web/src/components/LinkInput.tsx` — refactor to controlled component (`value`/`onChange` props, drop internal `useState`).
- `packages/web/package.json` — add `vitest` + `jsdom` devDependencies; add `test` / `test:watch` scripts.

No backend changes. No shared-types changes (HistoryEntry is web-only).

## Out of Scope (deferred)

- Search / filter — defer until list size demands it.
- Export / import history (JSON download) — easy to add later if requested.
- Per-platform filtering — same.
- Visual design polish (color tokens, spacing system) — deferred to a separate "establish project DESIGN.md" task per the `creating-design-md` skill.
