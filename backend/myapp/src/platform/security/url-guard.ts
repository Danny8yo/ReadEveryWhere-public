import { isIP } from "node:net";
import { AppException } from "../http/app-exception";

/**
 * SSRF 防护：校验「目标地址来自用户输入」的外发 URL 是否安全。
 *
 * 规则：
 * - 必须是合法 URL，且协议为 http/https（可强制仅 https）。
 * - 不允许在 URL 里内嵌账号密码（user:pass@host）。
 * - 拒绝指向本机 / 内网 / 链路本地 / 云元数据等保留网段的 IP 字面量。
 * - 拒绝 localhost 等明显的本机主机名。
 *
 * 已知限制：本函数为「写入时」的同步校验，无法防御 DNS rebinding
 * （域名在请求时才解析到内网 IP）。如需更强防护，应在 HTTP 请求层
 * 对解析后的 IP 再做一次拦截（后续可加 axios lookup 钩子）。
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

  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateIPv4(hostname)) {
    throw AppException.validation(field, "URL host points to a private/reserved address");
  }
  if (ipVersion === 6 && isPrivateIPv6(hostname)) {
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

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // 不是规范的 IPv4，交给上层当作主机名处理；这里保守地不放行
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 私有
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私有
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 私有
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 等保留
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 基准测试
  if (a >= 224) return true; // 224.0.0.0/4 组播 + 240.0.0.0/4 保留
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // 回环 / 未指定
  // IPv4-mapped（::ffff:a.b.c.d）：提取内嵌 IPv4 再判断
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 唯一本地
  if (lower.startsWith("fe80") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // fe80::/10 链路本地
  }
  return false;
}
