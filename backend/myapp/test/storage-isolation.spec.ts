import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Jest storage isolation", () => {
  it("uses a temporary storage root instead of shared application data", () => {
    const configuredRoot = resolve(process.cwd(), process.env.DOWNLOAD_STORAGE_PATH!);
    const sharedRoot = resolve(process.cwd(), "data/downloads");

    expect(configuredRoot).not.toBe(sharedRoot);
    expect(configuredRoot).toContain("read-everywhere-jest-storage-");
    expect(existsSync(configuredRoot)).toBe(true);
  });
});
