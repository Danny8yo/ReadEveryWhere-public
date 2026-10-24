import { assertSafeOutboundUrl, isBlockedAddress } from "./url-guard";

describe("assertSafeOutboundUrl", () => {
  it.each([
    "https://127.0.0.1/",
    "https://10.1.2.3/",
    "https://169.254.169.254/",
    "https://[::1]/",
    // URL 会把 IPv4-mapped 规范化成十六进制写法，曾绕过点分形式的正则。
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[::127.0.0.1]/",
    "https://[64:ff9b::a9fe:a9fe]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://localhost/",
    "https://api.internal/",
  ])("rejects %s", (url) => {
    expect(() => assertSafeOutboundUrl(url)).toThrow();
  });

  it.each(["https://example.com/", "https://93.184.216.34/", "https://[2606:4700::1111]/"])(
    "allows %s",
    (url) => {
      expect(assertSafeOutboundUrl(url)).toBe(url);
    },
  );

  it("rejects non-https and embedded credentials", () => {
    expect(() => assertSafeOutboundUrl("http://example.com/")).toThrow();
    expect(() => assertSafeOutboundUrl("https://user:pass@example.com/")).toThrow();
  });
});

describe("isBlockedAddress", () => {
  it("treats non-IP input as blocked", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
  });

  it("matches IPv4-mapped IPv6 against IPv4 ranges", () => {
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedAddress("::ffff:5db8:d822")).toBe(false);
  });
});
