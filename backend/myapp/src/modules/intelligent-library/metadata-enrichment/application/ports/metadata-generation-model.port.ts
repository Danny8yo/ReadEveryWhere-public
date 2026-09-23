import type {
  BookMetadataProjection,
  EbookFormat,
  MetadataSection,
  MetadataSectionDescriptor,
} from "../../../public";

export interface AiMetadataDraft {
  title: string;
  authors: string[];
  isbn: string | null;
  publisher: string | null;
  publishYear: number | null;
  description: string | null;
  language: string | null;
  editionTag: string | null;
}

export interface MetadataGenerationModelPort {
  selectFrontMatter(input: {
    userId: number;
    book: BookMetadataProjection;
    format: EbookFormat;
    sections: readonly MetadataSectionDescriptor[];
  }): Promise<{ sectionIds: string[] }>;
  generateMetadata(input: {
    userId: number;
    book: BookMetadataProjection;
    selectedSections: readonly MetadataSection[];
  }): Promise<AiMetadataDraft>;
}

export const METADATA_GENERATION_MODEL_PORT = Symbol("METADATA_GENERATION_MODEL_PORT");
