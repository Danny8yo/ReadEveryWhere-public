export interface SourcePoint { path: number[]; offset: number }
export interface SourceRange { start: SourcePoint; end: SourcePoint }
export interface CanonicalRange { start: number; end: number }
export interface CanonicalSelection extends CanonicalRange { quote: string }
export interface ContentScope { bookId: number; fileChecksum: string; extractorVersion: string; normalizationVersion: string; sectionIndex: number; href: string }
export interface SelectionRequest { scope: ContentScope; source: SourceRange; displayedQuote: string }
export interface ResolvedSelection extends CanonicalRange { scope: ContentScope; source: SourceRange; displayedQuote: string; canonicalQuote: string }
export type SegmentKind = 'text' | 'collapsed-whitespace' | 'block-separator' | 'line-break' | 'image-alt';
export interface SourceSegment { text: string; canonicalStart: number; canonicalEnd: number; start: SourcePoint | null; end: SourcePoint | null; kind: SegmentKind; preserve: boolean; linear: boolean }
export interface SourceSegments extends Iterable<SourceSegment> {
    readonly length: number;
    readonly data: Uint32Array;
    readonly paths: number[][];
    at(index: number): SourceSegment | undefined;
    find(predicate: (segment: SourceSegment) => boolean): SourceSegment | undefined;
    filter(predicate: (segment: SourceSegment) => boolean): SourceSegment[];
    map<T>(transform: (segment: SourceSegment) => T): T[];
    toJSON(): SourceSegment[];
}
export interface SourceMap { text: string; segments: SourceSegments; sources: Map<string, string> }
