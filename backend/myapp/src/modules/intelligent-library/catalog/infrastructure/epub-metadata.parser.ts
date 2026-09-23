import { Injectable, Logger } from "@nestjs/common";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { assertZipWithinLimits } from "../../../../platform/security/zip-guard";
import { AppException } from "../../../../platform/http/app-exception";

export interface EpubMetadata {
  title?: string;
  authors?: string[];
  isbn?: string;
  publisher?: string;
  publishYear?: number;
  description?: string;
  language?: string;
}

@Injectable()
export class EpubMetadataParser {
  private readonly logger = new Logger(EpubMetadataParser.name);

  extract(buffer: Buffer): EpubMetadata | null {
    if (!buffer || buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return null;
    try {
      const zip = new AdmZip(buffer);
      assertZipWithinLimits(zip);

      const containerEntry = zip.getEntry("META-INF/container.xml");
      if (!containerEntry) throw AppException.validation("file", "EPUB container.xml is missing");

      const containerXml = containerEntry.getData().toString("utf-8");
      const container = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: false,
      }).parse(containerXml);

      const rootfiles = container?.container?.rootfiles?.rootfile;
      const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
      const opfPath = rootfile?.["@_full-path"];
      if (typeof opfPath !== "string" || !opfPath.trim()) {
        throw AppException.validation("file", "EPUB rootfile path is missing");
      }

      const decodedPath = decodeURIComponent(opfPath);
      const opfEntry = zip.getEntry(decodedPath);
      if (!opfEntry) throw AppException.validation("file", "EPUB package document is missing");

      const opfXml = opfEntry.getData().toString("utf-8");
      const opf = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: false,
      }).parse(opfXml);

      const metadata = opf?.package?.metadata;
      if (!metadata) throw AppException.validation("file", "EPUB metadata element is missing");

      return {
        title: this.extractTitle(metadata),
        authors: this.extractAuthors(metadata),
        isbn: this.extractIsbn(metadata),
        publisher: this.extractPublisher(metadata),
        publishYear: this.extractPublishYear(metadata),
        description: this.extractDescription(metadata),
        language: this.extractLanguage(metadata),
      };
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.warn(`EPUB metadata extraction failed: ${error}`);
      throw AppException.validation("file", "EPUB metadata is malformed");
    }
  }

  private extractTitle(metadata: Record<string, unknown>): string | undefined {
    const val = this.firstDcValue(metadata, "title");
    return val?.trim() || undefined;
  }

  private extractAuthors(metadata: Record<string, unknown>): string[] | undefined {
    const creators = this.dcValues(metadata, "creator");
    if (!creators.length) return undefined;
    const filtered = creators.filter((c) => {
      const obj = typeof c === "string" ? {} : c;
      const role = ((obj as Record<string, unknown>)["@_role"] as string | undefined) ||
        ((obj as Record<string, unknown>)["@_opf:role"] as string | undefined) ||
        "";
      if (!role) return true;
      return !["ill", "illustrator", "editor", "edt", "translator", "trl"].includes(role);
    });
    const names = filtered.length ? filtered : creators;
    return names
      .map((n) => (typeof n === "string" ? n.trim() : (n as Record<string, unknown>)["#text"]?.toString().trim() || ""))
      .filter(Boolean);
  }

  private extractIsbn(metadata: Record<string, unknown>): string | undefined {
    const ids = this.dcValues(metadata, "identifier");
    for (const raw of ids) {
      const id = typeof raw === "string" ? raw : ((raw as Record<string, unknown>)["#text"] as string) || "";
      const cleaned = id.replace(/^urn:isbn:/i, "").replace(/[-\s]/g, "");
      if (/^\d{9}[\dX]$/i.test(cleaned) || /^\d{13}$/.test(cleaned)) {
        return cleaned;
      }
    }
    return undefined;
  }

  private extractPublisher(metadata: Record<string, unknown>): string | undefined {
    const val = this.firstDcValue(metadata, "publisher");
    return val?.trim() || undefined;
  }

  private extractPublishYear(metadata: Record<string, unknown>): number | undefined {
    const val = this.firstDcValue(metadata, "date");
    if (!val) return undefined;
    const match = val.match(/\b(\d{4})\b/);
    if (!match) return undefined;
    const year = Number(match[1]);
    return year > 0 && year <= 9999 ? year : undefined;
  }

  private extractDescription(metadata: Record<string, unknown>): string | undefined {
    const val = this.firstDcValue(metadata, "description");
    return val?.trim() || undefined;
  }

  private extractLanguage(metadata: Record<string, unknown>): string | undefined {
    const val = this.firstDcValue(metadata, "language");
    return val?.trim() || undefined;
  }

  private firstDcValue(metadata: Record<string, unknown>, dcName: string): string | undefined {
    const key = `dc:${dcName}`;
    const val = metadata[key];
    if (!val) return undefined;
    if (typeof val === "string") return val;
    if (typeof val === "number") return String(val);
    if (Array.isArray(val)) {
      const first = val[0];
      if (typeof first === "string") return first;
      if (typeof first === "number") return String(first);
      return (first as Record<string, unknown>)?.["#text"] as string | undefined;
    }
    return (val as Record<string, unknown>)["#text"] as string | undefined;
  }

  private dcValues(metadata: Record<string, unknown>, dcName: string): Array<Record<string, unknown> | string> {
    const key = `dc:${dcName}`;
    const val = metadata[key];
    if (!val) return [];
    return Array.isArray(val) ? (val as Array<Record<string, unknown> | string>) : [val as Record<string, unknown> | string];
  }
}
