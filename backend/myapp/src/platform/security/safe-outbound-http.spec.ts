import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import axios from "axios";
import { createSafeOutboundAgents, OUTBOUND_ADDRESS_BLOCKED, safeLookup } from "./safe-outbound-http";

jest.mock("node:dns", () => {
  const actual = jest.requireActual("node:dns");
  return { ...actual, lookup: jest.fn(actual.lookup) };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dns = require("node:dns") as { lookup: jest.Mock };

const lookupAsync = (hostname: string, all = false) =>
  new Promise<unknown>((resolve, reject) => {
    safeLookup(hostname, { all }, (error: Error | null, address: unknown) =>
      error ? reject(error) : resolve(address));
  });

describe("safe outbound http", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_req, res) => res.end("internal"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const request = (url: string) => {
    const agents = createSafeOutboundAgents();
    return axios.get(url, { ...agents, proxy: false, timeout: 5000 }).finally(() => {
      agents.httpAgent.destroy();
      agents.httpsAgent.destroy();
    });
  };

  it("blocks IP literal targets before connecting", async () => {
    await expect(request(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ code: OUTBOUND_ADDRESS_BLOCKED });
    await expect(request(`http://[::ffff:7f00:1]:${port}/`)).rejects.toMatchObject({ code: OUTBOUND_ADDRESS_BLOCKED });
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    await expect(request(`http://localhost:${port}/`)).rejects.toMatchObject({ code: OUTBOUND_ADDRESS_BLOCKED });
  });

  it("rejects a lookup when any resolved address is private", async () => {
    dns.lookup.mockImplementationOnce((_host, _options, callback) =>
      callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.8", family: 4 }]));
    await expect(lookupAsync("rebind.example")).rejects.toMatchObject({ code: OUTBOUND_ADDRESS_BLOCKED });
  });

  it("passes public lookups through in both single and all modes", async () => {
    const addresses = [{ address: "93.184.216.34", family: 4 }];
    dns.lookup.mockImplementation((_host, _options, callback) => callback(null, addresses));
    try {
      await expect(lookupAsync("example.com")).resolves.toBe("93.184.216.34");
      await expect(lookupAsync("example.com", true)).resolves.toEqual(addresses);
    } finally {
      dns.lookup.mockImplementation(jest.requireActual("node:dns").lookup);
    }
  });
});
