import { FileValidator } from "@nestjs/common";
import AdmZip from "adm-zip";
import { AppException } from "../../../../platform/http/app-exception";
import { assertZipWithinLimits } from "../../../../platform/security/zip-guard";
import {
  EBOOK_FORMAT_MIME_TYPES,
  type EbookFormat,
} from "../domain/ebook-format";

export type SupportedEbookFormat = EbookFormat;

/**
 * 校验 Buffer 是否为合法的 EPUB 文件（ZIP 魔数 + mimetype 条目）。
 */
export function validateEpubBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 30) {
    return false;
  }

  // ZIP local file header 魔数 PK\x03\x04
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    return false;
  }

  try {
    const zip = new AdmZip(buffer);
    assertZipWithinLimits(zip);
    const mimetypeEntry = zip.getEntry("mimetype");
    if (!mimetypeEntry) {
      return false;
    }
    const mimetypeContent = mimetypeEntry.getData().toString("utf-8").trim();
    return mimetypeContent === "application/epub+zip";
  } catch (error) {
    if (error instanceof AppException) throw error;
    return false;
  }
}

/**
 * 校验 Buffer 是否为合法的 PDF 文件（%PDF- 魔数）。
 */
export function validatePdfBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  return buffer.slice(0, 5).toString() === "%PDF-";
}

/**
 * 校验 Buffer 是否为合法的 MOBI/AZW3 文件（Palm Database + BOOKMOBI 标识）。
 */
export function validateMobiBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 68) return false;
  return buffer.slice(60, 68).toString("ascii") === "BOOKMOBI";
}

export function detectEbookFormat(buffer: Buffer, fileName = ""): SupportedEbookFormat | null {
  if (validateEpubBuffer(buffer)) return "epub";
  if (validatePdfBuffer(buffer)) return "pdf";
  if (validateMobiBuffer(buffer)) {
    return fileName.toLowerCase().endsWith(".azw3") ? "azw3" : "mobi";
  }
  return null;
}

export function mimeTypeForEbookFormat(format: SupportedEbookFormat): string {
  return EBOOK_FORMAT_MIME_TYPES[format];
}

export class EbookFileValidator extends FileValidator {
  isValid(file?: Express.Multer.File): boolean {
    if (!file || !file.buffer) return false;
    return detectEbookFormat(file.buffer, file.originalname) !== null;
  }

  buildErrorMessage(): string {
    return "File must be a valid EPUB, PDF, MOBI, or AZW3 file";
  }
}
