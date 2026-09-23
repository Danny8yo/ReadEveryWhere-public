import { Injectable } from "@nestjs/common";
import type { ImportedBookInspectorPort } from "../application/ports/imported-book-inspector.port";
import { detectEbookFormat, mimeTypeForEbookFormat } from "./ebook-format.validator";
import { EpubMetadataParser } from "./epub-metadata.parser";

@Injectable()
export class ImportedBookInspectorAdapter implements ImportedBookInspectorPort {
  constructor(private readonly parser: EpubMetadataParser) {}

  detectMimeType(buffer: Buffer, fileName: string): string | null {
    const format = detectEbookFormat(buffer, fileName);
    return format ? mimeTypeForEbookFormat(format) : null;
  }

  parseMetadata(buffer: Buffer) {
    return this.parser.extract(buffer);
  }
}
