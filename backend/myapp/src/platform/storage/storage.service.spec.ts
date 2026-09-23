import { StorageService } from "./storage.service";

describe("StorageService", () => {
  const original = process.env.DOWNLOAD_STORAGE_PATH;

  afterEach(() => {
    if (original === undefined) delete process.env.DOWNLOAD_STORAGE_PATH;
    else process.env.DOWNLOAD_STORAGE_PATH = original;
  });

  it("rejects paths sharing a storage-root prefix but outside the directory", () => {
    process.env.DOWNLOAD_STORAGE_PATH = "/tmp/storage-root";
    const storage = new StorageService();

    expect(() => storage.resolvePath("/tmp/storage-root-evil/file.epub")).toThrow(
      "Path traversal detected",
    );
  });
});
