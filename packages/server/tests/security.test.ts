import { describe, it, expect } from "vitest";
import { validateUrl, sanitizeFilename } from "@vd/shared";

describe("validateUrl", () => {
  it("should accept valid HTTP URLs", () => {
    expect(() => validateUrl("https://twitter.com/user/status/123")).not.toThrow();
    expect(() => validateUrl("http://example.com")).not.toThrow();
  });

  it("should reject non-HTTP protocols", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow("Only HTTP and HTTPS");
    expect(() => validateUrl("javascript:alert(1)")).toThrow();
    expect(() => validateUrl("file:///etc/passwd")).toThrow();
  });

  it("should reject invalid URLs", () => {
    expect(() => validateUrl("not a url")).toThrow("Invalid URL");
    expect(() => validateUrl("")).toThrow();
  });

  it("should reject localhost", () => {
    expect(() => validateUrl("http://localhost:3000")).toThrow("local addresses");
    expect(() => validateUrl("http://0.0.0.0")).toThrow("local addresses");
  });

  it("should reject private IP ranges", () => {
    expect(() => validateUrl("http://127.0.0.1")).toThrow("private IP");
    expect(() => validateUrl("http://10.0.0.1")).toThrow("private IP");
    expect(() => validateUrl("http://192.168.1.1")).toThrow("private IP");
    expect(() => validateUrl("http://172.16.0.1")).toThrow("private IP");
    expect(() => validateUrl("http://169.254.1.1")).toThrow("private IP");
  });

  it("should accept public IPs", () => {
    expect(() => validateUrl("http://8.8.8.8")).not.toThrow();
    expect(() => validateUrl("https://1.1.1.1")).not.toThrow();
  });
});

describe("sanitizeFilename", () => {
  it("should remove illegal characters", () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toBe("filename");
  });

  it("should collapse whitespace", () => {
    expect(sanitizeFilename("hello   world  test")).toBe("hello world test");
  });

  it("should trim to maxLength", () => {
    const long = "a".repeat(200);
    expect(sanitizeFilename(long, 50).length).toBe(50);
  });

  it("should handle empty string", () => {
    expect(sanitizeFilename("")).toBe("");
  });
});
