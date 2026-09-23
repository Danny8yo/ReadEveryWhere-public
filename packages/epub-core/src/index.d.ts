export const EPUB_EXTRACTOR_VERSION: 'epub-extractor-v5';
export const NORMALIZATION_VERSION: 'epub-source-map-v2';
export type MediaType = 'application/xhtml+xml' | 'text/html';
export interface ParserPort { parseFromString(source: string, mediaType: MediaType): Document }
export * from './types.js';
import type { SourceRange, CanonicalRange, CanonicalSelection, ContentScope, SelectionRequest, ResolvedSelection, SourceMap } from './types.js';
export class LocationError extends Error { code: string; constructor(code: string, detail: string) }
export function parseChapter(source: string, mediaType: MediaType, parser: ParserPort): { document: Document; effectiveMediaType: MediaType };
export function addressOf(node: Node): number[];
export function nodeAt(document: Document, address: number[]): Node;
export function buildSourceMap(document: Document): SourceMap;
export function sourceToCanonical(map: SourceMap, source: SourceRange): CanonicalSelection;
export function canonicalToSource(map: SourceMap, range: CanonicalRange): SourceRange;
export function rangeFromSource(document: Document, source: SourceRange): Range;
export function resolveSelection(document: Document, map: SourceMap, expectedScope: ContentScope, request: SelectionRequest): ResolvedSelection;
export function canonicalOffsetAtElement(map: SourceMap, element: Element): number;
