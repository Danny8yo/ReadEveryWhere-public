import type { EvidenceRecord } from "../domain";
import { toModelVisibleData } from "./model-visible-data";

interface ModelLocator {
  version: 1;
  position: {
    kind: "epub_text";
    sectionIndex: number;
    start: number;
    end: number;
  };
}

export class ModelToolResultPresenter {
  present(
    toolName: string,
    outputValue: unknown,
    evidenceRecords: readonly EvidenceRecord[] = [],
  ): unknown {
    const output = asRecord(outputValue);
    switch (toolName) {
      case "book_toc":
        return this.outline(output);
      case "book_toc_tree":
        return { entries: arrayOfRecords(output.entries).map((entry) => this.treeEntry(entry)) };
      case "book_toc_navigation":
        return {
          entries: arrayOfRecords(output.entries).map((entry) => ({
            nodeId: entry.nodeId,
            label: entry.label,
            startLocator: minimumLocator(entry.startLocator),
            ...(entry.endLocator ? { endLocator: minimumLocator(entry.endLocator) } : {}),
          })),
        };
      case "book_read_from_toc":
      case "book_read":
        return this.read(output, evidenceRecords);
      default:
        return toModelVisibleData(outputValue);
    }
  }


  private outline(output: Record<string, unknown>) {
    return {
      entries: arrayOfRecords(output.entries).map((entry) => ({
        nodeId: entry.nodeId,
        parentNodeId: entry.parentNodeId ?? null,
        label: entry.label,
        level: entry.level,
        chars: entry.subtreeCharCount,
        hasChildren: entry.hasChildren === true,
      })),
      nextCursor: typeof output.nextCursor === "string" ? output.nextCursor : null,
      hasMore: output.hasMore === true,
    };
  }

  private treeEntry(entry: Record<string, unknown>): Record<string, unknown> {
    return {
      nodeId: entry.nodeId,
      label: entry.label,
      chars: entry.subtreeCharCount,
      children: arrayOfRecords(entry.children).map((child) => this.treeEntry(child)),
    };
  }

  private read(output: Record<string, unknown>, evidenceRecords: readonly EvidenceRecord[]) {
    const text = typeof output.text === "string" ? output.text : "";
    const outputSegments = arrayOfRecords(output.segments).map((segment) => {
      const citation = asRecord(segment.citation);
      const position = locatorPosition(citation.locator);
      if (!position) throw new Error("MODEL_BOOK_READ_SEGMENT_LOCATOR_INVALID");
      return {
        textStart: Number(segment.textStart),
        textEnd: Number(segment.textEnd),
        sectionIndex: position.sectionIndex,
        start: position.start,
        end: position.end,
        chapterPath: stringOrNull(citation.chapterPath),
      };
    });
    const boundary = asRecord(output.boundary);
    if (Array.isArray(output.units)) {
      const projectUnit = (unit: Record<string, unknown>) => ({ ...unit,
        startLocator: minimumLocator(unit.startLocator), endLocator: minimumLocator(unit.endLocator) });
      return { text, segments: outputSegments,
        units: arrayOfRecords(output.units).map(projectUnit),
        unavailable: arrayOfRecords(output.unavailable).map(projectUnit),
        continuation: output.continuation, coverage: output.coverage,
        evidence: evidenceRanges(text, outputSegments, evidenceRecords) };
    }
    return {
      text,
      ...(output.node ? { node: toModelVisibleData(output.node) } : {}),
      segments: outputSegments,
      continuation: {
        previous: continuationRequest(output, "previous"),
        next: continuationRequest(output, "next"),
      },
      boundary: {
        sectionStart: boundary.sectionStart === true || output.reachedSectionStart === true,
        sectionEnd: boundary.sectionEnd === true || output.reachedSectionEnd === true,
        bookStart: boundary.bookStart === true || output.reachedBookStart === true,
        bookEnd: boundary.bookEnd === true || output.reachedBookEnd === true,
      },
      evidence: evidenceRanges(text, outputSegments, evidenceRecords),
    };
  }
}

function continuationRequest(
  output: Record<string, unknown>,
  key: "previous" | "next",
): { locator: ModelLocator; endLocator?: ModelLocator; direction: "forward" | "backward"; maxChars?: number } | null {
  const continuationValue = output.continuation;
  const continuation = asRecord(continuationValue);
  const request = asRecord(continuation[key]);
  const direction = key === "previous" ? "backward" : "forward";
  if (request.locator) {
    const maxChars = isBookReadMaxChars(request.maxChars) ? request.maxChars : undefined;
    return {
      locator: minimumLocator(request.locator),
      ...(request.endLocator ? { endLocator: minimumLocator(request.endLocator) } : {}),
      direction,
      ...(maxChars !== undefined ? { maxChars } : {}),
    };
  }
  if (isRecord(continuationValue) && Object.prototype.hasOwnProperty.call(continuationValue, key)) return null;
  const fallback = key === "previous" ? output.previousLocator : output.nextLocator;
  if (fallback === null || fallback === undefined) return null;
  return { locator: minimumLocator(fallback), direction };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evidenceRanges(
  text: string,
  segments: Array<{
    textStart: number;
    textEnd: number;
    sectionIndex: number;
    start: number;
    end: number;
  }>,
  evidenceRecords: readonly EvidenceRecord[],
): Array<{ evidenceId: string; textStart: number; textEnd: number }> {
  if (evidenceRecords.length === 0) return [];
  return evidenceRecords.map((record) => {
    const position = locatorPosition(record.citation.locator);
    if (!position) throw new Error("MODEL_BOOK_READ_EVIDENCE_LOCATOR_INVALID");
    const segment = segments.find((candidate) => candidate.sectionIndex === position.sectionIndex
      && candidate.start <= position.start && candidate.end >= position.end);
    if (!segment) throw new Error("MODEL_BOOK_READ_EVIDENCE_SEGMENT_MISSING");
    const textStart = segment.textStart + position.start - segment.start;
    const textEnd = segment.textStart + position.end - segment.start;
    if (textStart < 0 || textEnd < textStart || textEnd > text.length) {
      throw new Error("MODEL_BOOK_READ_EVIDENCE_RANGE_INVALID");
    }
    return { evidenceId: record.evidenceId, textStart, textEnd };
  });
}

function nullableMinimumLocator(value: unknown): ModelLocator | null {
  if (value === null || value === undefined) return null;
  return minimumLocator(value);
}

function minimumLocator(value: unknown): ModelLocator {
  const locator = asRecord(value);
  const position = locatorPosition(locator);
  if (locator.version !== 1 || !position) throw new Error("MODEL_READ_LOCATOR_INVALID");
  return {
    version: 1,
    position,
  };
}

function locatorPosition(value: unknown): ModelLocator["position"] | null {
  const locator = asRecord(value);
  const position = asRecord(locator.position);
  if (
    position.kind !== "epub_text"
    || !isNonNegativeInteger(position.sectionIndex)
    || !isNonNegativeInteger(position.start)
    || !isNonNegativeInteger(position.end)
    || position.end < position.start
  ) return null;
  return {
    kind: "epub_text",
    sectionIndex: position.sectionIndex,
    start: position.start,
    end: position.end,
  };
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBookReadMaxChars(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 200 && Number(value) <= 50_000;
}
