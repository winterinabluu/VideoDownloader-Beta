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
