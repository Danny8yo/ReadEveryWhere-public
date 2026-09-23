import { ImportBookUseCase } from "./import-book.use-case";

describe("ImportBookUseCase", () => {
  it("removes a partially written file when storage write fails", async () => {
    const files = {
      pathForImport: jest.fn().mockReturnValue("/tmp/partial.pdf"),
      exists: jest.fn().mockReturnValue(false),
      write: jest.fn(() => { throw new Error("write failed"); }),
      remove: jest.fn(),
      stagingPathForImport: jest.fn(),
    };
    const useCase = new ImportBookUseCase(
      { insert: jest.fn() } as any,
      { findByChecksum: jest.fn().mockReturnValue(null) } as any,
      {} as any,
      files,
      { detectMimeType: jest.fn().mockReturnValue("application/pdf"), parseMetadata: jest.fn().mockReturnValue(null) } as any,
      {} as any,
    );

    await expect(useCase.execute({
      userId: 1,
      file: { originalname: "book.pdf", buffer: Buffer.from("pdf"), size: 3, mimetype: "application/pdf" },
      conflictPolicy: "rename",
    })).rejects.toThrow("write failed");
    expect(files.remove).toHaveBeenCalledWith("/tmp/partial.pdf");
  });

  it("writes overwrite imports to a staging path so the existing file survives later failure", async () => {
    const files = {
      pathForImport: jest.fn().mockReturnValue("/tmp/book.pdf"),
      stagingPathForImport: jest.fn().mockReturnValue("/tmp/.staging/new-book.pdf"),
      exists: jest.fn().mockReturnValue(true),
      write: jest.fn(),
      remove: jest.fn(),
    };
    const useCase = new ImportBookUseCase(
      { insert: jest.fn(() => { throw new Error("db failed"); }) } as any,
      { findByChecksum: jest.fn().mockReturnValue(null) } as any,
      {} as any,
      files,
      { detectMimeType: jest.fn().mockReturnValue("application/pdf"), parseMetadata: jest.fn().mockReturnValue(null) } as any,
      {} as any,
    );

    await expect(useCase.execute({
      userId: 1,
      file: { originalname: "book.pdf", buffer: Buffer.from("pdf"), size: 3, mimetype: "application/pdf" },
      conflictPolicy: "overwrite",
    })).rejects.toThrow("db failed");
    expect(files.write).toHaveBeenCalledWith("/tmp/.staging/new-book.pdf", expect.any(Buffer));
    expect(files.remove).toHaveBeenCalledWith("/tmp/.staging/new-book.pdf");
  });
});
