import { detectEbookFormat, mimeTypeForEbookFormat, validateMobiBuffer } from "./ebook-format.validator";

const makeMobiLikeBuffer = () => {
  const buffer = Buffer.alloc(128);
  buffer.write("BOOKMOBI", 60, "ascii");
  return buffer;
};

describe("ebook format validator", () => {
  it("detects MOBI files by BOOKMOBI header", () => {
    const buffer = makeMobiLikeBuffer();

    expect(validateMobiBuffer(buffer)).toBe(true);
    expect(detectEbookFormat(buffer, "sample.mobi")).toBe("mobi");
    expect(mimeTypeForEbookFormat("mobi")).toBe("application/x-mobipocket-ebook");
  });

  it("detects AZW3 files by extension when the file has a MOBI container", () => {
    const buffer = makeMobiLikeBuffer();

    expect(detectEbookFormat(buffer, "sample.azw3")).toBe("azw3");
    expect(mimeTypeForEbookFormat("azw3")).toBe("application/vnd.amazon.ebook");
  });

  it("rejects unknown binary data", () => {
    expect(detectEbookFormat(Buffer.from("not an ebook"), "sample.txt")).toBeNull();
  });
});
