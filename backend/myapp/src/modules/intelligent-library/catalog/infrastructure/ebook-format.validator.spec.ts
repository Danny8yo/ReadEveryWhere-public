import zlib from "node:zlib";
import AdmZip from "adm-zip";
import {
  detectEbookFormat,
  mimeTypeForEbookFormat,
  validateEpubBuffer,
  validateMobiBuffer,
} from "./ebook-format.validator";

const makeMobiLikeBuffer = () => {
  const buffer = Buffer.alloc(128);
  buffer.write("BOOKMOBI", 60, "ascii");
  return buffer;
};

// 声明解压大小为 0、实际是 8MB 全零的 deflate 条目：zip-guard 按声明大小放行，
// 只能靠 adm-zip >= 0.6.1 的 maxOutputLength 下限阻止整段解压（GHSA-rcw4-f5rp-g42v）。
const makeLyingSizeEpub = () => {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.alloc(8 * 1024 * 1024));
  const bytes = zip.toBuffer();
  for (const [signature, sizeOffset] of [[0x04034b50, 22], [0x02014b50, 24]] as const) {
    for (let i = 0; i <= bytes.length - 4; i += 1) {
      if (bytes.readUInt32LE(i) === signature) bytes.writeUInt32LE(0, i + sizeOffset);
    }
  }
  return bytes;
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

  it("does not inflate zip entries beyond their declared size", () => {
    const bomb = makeLyingSizeEpub();
    const inflate = jest.spyOn(zlib, "inflateRawSync");
    try {
      expect(validateEpubBuffer(bomb)).toBe(false);
      const inflatedBytes = inflate.mock.results
        .filter((result) => result.type === "return")
        .reduce((total, result) => total + (result.value as Buffer).length, 0);
      expect(inflate).toHaveBeenCalled();
      expect(inflatedBytes).toBeLessThanOrEqual(1);
    } finally {
      inflate.mockRestore();
    }
  });

  it("rejects unknown binary data", () => {
    expect(detectEbookFormat(Buffer.from("not an ebook"), "sample.txt")).toBeNull();
  });
});
