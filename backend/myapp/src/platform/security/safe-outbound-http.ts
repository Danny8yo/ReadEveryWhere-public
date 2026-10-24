import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { Agent as HttpAgent, type AgentOptions } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP, type LookupFunction, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { isBlockedAddress } from "./url-guard";

/**
 * SSRF 连接层防护：目标地址来自用户输入的外发请求（Z-Library baseUrl、上游返回的下载链接等）
 * 必须走这里的 Agent。
 *
 * url-guard 只能在写入时校验 URL 字面量；域名解析到内网、DNS rebinding、302 跳到内网都要在
 * 真正建立 TCP 连接时拦截。axios/follow-redirects 每一跳都按协议复用 agents.http / agents.https，
 * 因此重定向目标同样经过这里。
 */
export const OUTBOUND_ADDRESS_BLOCKED = "ERR_OUTBOUND_ADDRESS_BLOCKED";

function blockedAddressError(host: string, address: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `Outbound connection to ${host} (${address}) is blocked`,
  );
  error.code = OUTBOUND_ADDRESS_BLOCKED;
  return error;
}

/** 解析域名后，只要任一候选地址落在禁止网段就拒绝，避免 Happy Eyeballs 挑中内网地址。 */
export const safeLookup = ((
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const blocked = addresses.find((entry) => isBlockedAddress(entry.address));
    if (blocked) return callback(blockedAddressError(hostname, blocked.address), []);
    if (options.all) return callback(null, addresses);
    const [first] = addresses;
    callback(null, first.address, first.family);
  });
}) as LookupFunction;

type ConnectionCallback = (error: Error | null, socket: Duplex) => void;

/** Node 对 IP 字面量跳过 lookup，必须在 createConnection 前单独校验。 */
function rejectBlockedLiteral(host: unknown, callback: ConnectionCallback): boolean {
  if (typeof host !== "string") return false;
  const address = host.replace(/^\[|\]$/g, "");
  if (!isIP(address) || !isBlockedAddress(address)) return false;
  process.nextTick(callback, blockedAddressError(host, address));
  return true;
}

class SafeHttpAgent extends HttpAgent {
  override createConnection(options: { host?: string }, callback: ConnectionCallback): Socket {
    if (rejectBlockedLiteral(options.host, callback)) return undefined as unknown as Socket;
    return (HttpAgent.prototype as unknown as {
      createConnection: (options: unknown, callback: ConnectionCallback) => Socket;
    }).createConnection.call(this, options, callback);
  }
}

class SafeHttpsAgent extends HttpsAgent {
  override createConnection(options: { host?: string }, callback: ConnectionCallback): Socket {
    if (rejectBlockedLiteral(options.host, callback)) return undefined as unknown as Socket;
    return (HttpsAgent.prototype as unknown as {
      createConnection: (options: unknown, callback: ConnectionCallback) => Socket;
    }).createConnection.call(this, options, callback);
  }
}

export function createSafeOutboundAgents() {
  const options: AgentOptions = { keepAlive: true, lookup: safeLookup };
  return { httpAgent: new SafeHttpAgent(options), httpsAgent: new SafeHttpsAgent(options) };
}

/**
 * 供 HttpModule.register 使用。proxy: false 防止环境变量里的 HTTP(S)_PROXY 让请求改走代理，
 * 那样连接层校验的就成了代理地址而不是真实目标。
 */
export function safeOutboundHttpConfig() {
  return { ...createSafeOutboundAgents(), proxy: false as const };
}
