import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousStoragePath = process.env.DOWNLOAD_STORAGE_PATH;
const testStorageRoot = mkdtempSync(join(tmpdir(), "read-everywhere-jest-storage-"));

// Every Jest test file gets a private storage root, so file-producing tests
// cannot write into the developer's shared data directory.
process.env.DOWNLOAD_STORAGE_PATH = testStorageRoot;

afterAll(() => {
  rmSync(testStorageRoot, { recursive: true, force: true });

  if (previousStoragePath === undefined) {
    delete process.env.DOWNLOAD_STORAGE_PATH;
  } else {
    process.env.DOWNLOAD_STORAGE_PATH = previousStoragePath;
  }
});
