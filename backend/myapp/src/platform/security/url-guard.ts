import { BlockList, isIP } from "node:net";
import { AppException } from "../http/app-exception";

// 本机、内网、链路本地（含云元数据 169.254.169.254）、CGNAT、文档网段、组播与保留网段。
// IPv4-mapped（::ffff:a.b.c.d，含 URL 规范化后的 ::ffff:7f00:1 写法）由 BlockList 按 IPv4 规则匹配。
// 不含 198.18.0.0/15：Clash/Surge 等代理的 fake-ip DNS 把所有域名解析到这个段，拦截会让
// 部署在这类网络里的实例无法访问任何上游；该段本身不是内网。
const BLOCKED_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  // ::/96 同时覆盖 ::、::1 与已废弃的 IPv4-compatible（::7f00:1）。
  ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/** 判断一个 IP 字面量是否落在禁止外发的网段；非 IP 字符串一律视为禁止。 */
export function isBlockedAddress(address: string): boolean {
  const ip = normalizeHostname(address);
  const version = isIP(ip);
  if (version === 4) return BLOCKED_ADDRESSES.check(ip, "ipv4");
  if (version === 6) return BLOCKED_ADDRESSES.check(ip, "ipv6");
  return true;
}

/**
 * SSRF 防护：校验「目标地址来自用户输入」的外发 URL 是否安全。
 *
 * 规则：
 * - 必须是合法 URL，且协议为 http/https（可强制仅 https）。
 * - 不允许在 URL 里内嵌账号密码（user:pass@host）。
 * - 拒绝指向本机 / 内网 / 链路本地 / 云元数据等保留网段的 IP 字面量。
 * - 拒绝 localhost 等明显的本机主机名。
 *
 * 本函数只是「写入时」的早期校验，用于给出明确的校验错误；域名解析到内网、
 * DNS rebinding 与重定向由 safe-outbound-http 的连接层 Agent 兜底拦截。
 */
export function assertSafeOutboundUrl(
  rawUrl: string,
  options: { field?: string; httpsOnly?: boolean } = {},
): string {
  const field = options.field ?? "url";
  const httpsOnly = options.httpsOnly ?? true;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw AppException.validation(field, "Invalid URL format");
  }

  if (httpsOnly) {
    if (parsed.protocol !== "https:") {
      throw AppException.validation(field, "Only https URLs are allowed");
    }
  } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw AppException.validation(field, "Only http/https URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw AppException.validation(field, "URL must not contain credentials");
  }

  const hostname = normalizeHostname(parsed.hostname);

  if (isBlockedHostname(hostname)) {
    throw AppException.validation(field, "URL host is not allowed");
  }

  if (isIP(hostname) && isBlockedAddress(hostname)) {
    throw AppException.validation(field, "URL host points to a private/reserved address");
  }

  return parsed.toString();
}

/** 去掉 IPv6 字面量的方括号，小写化主机名。 */
function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }
  return lower;
}

function isBlockedHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === "localhost") return true;
  // 任意以 .localhost / .local / .internal 结尾的本地/内网域名
  if (/\.(localhost|local|internal)$/.test(hostname)) return true;
  return false;
}
