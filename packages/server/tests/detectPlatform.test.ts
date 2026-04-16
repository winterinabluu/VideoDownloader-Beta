import { describe, it, expect } from "vitest";
import { detectPlatform } from "../src/platforms/registry";

describe("detectPlatform", () => {
  // Twitter / X
  const twitterUrls = [
    "https://twitter.com/user/status/1234567890",
    "https://x.com/user/status/1234567890",
    "https://www.twitter.com/user/status/1234567890",
    "https://mobile.twitter.com/user/status/1234567890",
    "https://x.com/elonmusk/status/1234567890123456789",
  ];

  for (const url of twitterUrls) {
    it(`should detect Twitter for: ${url}`, () => {
      const result = detectPlatform(url);
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("twitter");
    });
  }

  // Xiaohongshu
  const xhsUrls = [
    "https://www.xiaohongshu.com/explore/abc123def456",
    "https://xiaohongshu.com/discovery/item/abc123",
    "https://xhslink.com/a/abc123",
  ];

  for (const url of xhsUrls) {
    it(`should detect Xiaohongshu for: ${url}`, () => {
      const result = detectPlatform(url);
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("xiaohongshu");
    });
  }

  // Bilibili
  const bilibiliUrls = [
    "https://www.bilibili.com/video/BV1xx411c7mD",
    "https://bilibili.com/video/BV1xx411c7mD",
    "https://m.bilibili.com/video/BV1xx411c7mD",
    "https://b23.tv/abc123",
  ];

  for (const url of bilibiliUrls) {
    it(`should detect Bilibili for: ${url}`, () => {
      const result = detectPlatform(url);
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("bilibili");
    });
  }

  // YouTube
  const youtubeUrls = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com/shorts/abc123",
    "https://m.youtube.com/watch?v=abc123",
  ];

  for (const url of youtubeUrls) {
    it(`should detect YouTube for: ${url}`, () => {
      const result = detectPlatform(url);
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("youtube");
    });
  }

  // Weibo
  const weiboUrls = [
    "https://weibo.com/tv/show/1034:abc123",
    "https://m.weibo.cn/status/abc123",
    "https://video.weibo.com/show?fid=abc",
    "https://t.cn/abc123",
  ];

  for (const url of weiboUrls) {
    it(`should detect Weibo for: ${url}`, () => {
      const result = detectPlatform(url);
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("weibo");
    });
  }

  // Douyin
  const douyinUrls = [
    "https://www.douyin.com/video/abc123",
    "https://v.douyin.com/abc123",
  ];

  for (const url of douyinUrls) {
    it(`should detect Douyin for: ${url}`, () => {
      const result = detectPlatform(url);
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("douyin");
    });
  }

  // Unsupported
  it("should return null for unsupported URLs", () => {
    expect(detectPlatform("https://example.com/video")).toBeNull();
    expect(detectPlatform("https://vimeo.com/123456")).toBeNull();
    expect(detectPlatform("https://google.com")).toBeNull();
  });

  it("should return null for invalid URLs", () => {
    expect(detectPlatform("not a url")).toBeNull();
    expect(detectPlatform("")).toBeNull();
  });
});
