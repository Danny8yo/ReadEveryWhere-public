export interface ContentRevision {
  fileChecksum: string;
  extractorVersion: string;
  normalizationVersion: string;
}

export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface StructureHint {
  tocNodeId?: string;
  href?: string;
  fragment?: string;
  label?: string;
  path?: string;
}

export interface EpubBookLocatorV1 {
  version: 1;
  bookId: number;
  contentRevision: ContentRevision;
  position: {
    kind: "epub_text";
    sectionIndex: number;
    start: number;
    end: number;
  };
  textQuote?: TextQuoteSelector;
  structure?: StructureHint;
  readerAnchor?: {
    epubcfi?: string;
  };
}

export type EvidenceType =
  | "read_context"
  | "exact_match"
  | "semantic_candidate"
  | "user_annotation";

export interface Citation {
  sourceKind: "book_text" | "user_annotation";
  evidenceType: EvidenceType;
  bookId: number;
  bookTitle: string;
  authors: string[];
  chapterPath: string | null;
  locator: EpubBookLocatorV1;
  quote: string | null;
  annotationId: string | null;
}

export interface DocumentSection {
  sectionIndex: number;
  href: string;
  text: string;
  charCount: number;
  anchors: Record<string, number>;
}

export interface DocumentTocNode {
  nodeId: string;
  parentNodeId: string | null;
  linearIndex: number;
  level: number;
  label: string;
  path: string;
  href: string;
  fragment: string | null;
  sectionIndex: number;
  start: number;
  endSectionIndex?: number;
  end?: number;
  ownCharCount: number;
  subtreeCharCount: number;
  hasChildren: boolean;
  sourceHeadingLevel: 1 | 2 | 3 | 4 | 5 | 6 | null;
}

export interface TocProvenance {
  source: "ncx" | "epub_nav" | "spine_fallback";
  positionStrategy: "declared" | "repaired" | "spine_fallback";
  hierarchyStrategy: "declared" | "inferred_headings" | "flat" | "spine_fallback";
  headingMappedNodeCount: number;
  inferredParentCount: number;
}

export interface BookDocument {
  bookId: number;
  revision: ContentRevision;
  tocQuality: "declared" | "declared_repaired" | "spine_fallback";
  tocProvenance: TocProvenance;
  sections: DocumentSection[];
  toc: DocumentTocNode[];
}
