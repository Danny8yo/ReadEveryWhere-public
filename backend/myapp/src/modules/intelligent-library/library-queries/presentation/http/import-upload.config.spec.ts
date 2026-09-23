import { resolveImportMaxFileSizeBytes } from "./import-upload.config";

describe("resolveImportMaxFileSizeBytes", () => {
  it("defaults to 200 MB", () => {
    expect(resolveImportMaxFileSizeBytes(undefined)).toBe(200 * 1024 * 1024);
  });

  it("converts a configured integer MB value to bytes", () => {
    expect(resolveImportMaxFileSizeBytes("320")).toBe(320 * 1024 * 1024);
  });

  it.each(["", "0", "-1", "1.5", "not-a-number"])(
    "rejects invalid configuration %p",
    (value) => {
      expect(() => resolveImportMaxFileSizeBytes(value)).toThrow(
        "IMPORT_MAX_FILE_SIZE_MB must be a positive integer",
      );
    },
  );
});
