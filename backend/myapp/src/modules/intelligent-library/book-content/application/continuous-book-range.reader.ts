import type { BookDocument, DocumentSection, EpubBookLocatorV1 } from "../domain/book-document.types";
import { makeLocator } from "./reader-tool.utils";

export type SequentialReadDirection = "forward" | "backward";

export interface BookReadSlice {
  section: DocumentSection;
  start: number;
  end: number;
  text: string;
}

export interface ContinuousBookRangeResult {
  slices: BookReadSlice[];
  text: string;
  previousLocator: EpubBookLocatorV1 | null;
  nextLocator: EpubBookLocatorV1 | null;
  reachedSectionStart: boolean;
  reachedSectionEnd: boolean;
  reachedBookStart: boolean;
  reachedBookEnd: boolean;
}

export function readContinuousBookRange(input: {
  document: BookDocument;
  locator: EpubBookLocatorV1;
  direction: "forward" | "backward" | "around";
  maxChars: number;
  endLocator?: EpubBookLocatorV1;
}): ContinuousBookRangeResult {
  const { document, locator, direction, maxChars, endLocator } = input;
  const sections = [...document.sections].sort((left, right) => left.sectionIndex - right.sectionIndex);
  const readable = sections.filter((section) => section.text.length > 0);
  const focusSection = sections.find((section) => section.sectionIndex === locator.position.sectionIndex)!;

  let slices: BookReadSlice[];
  if (direction === "around") {
    const focusLength = locator.position.end - locator.position.start;
    const remaining = maxChars - focusLength;
    let start = Math.max(0, locator.position.start - Math.floor(remaining / 2));
    const end = Math.min(focusSection.text.length, start + maxChars);
    start = Math.max(0, end - maxChars);
    slices = end > start ? [slice(focusSection, start, end)] : [];
  } else if (direction === "forward") {
    slices = readForward(
      readable,
      { sectionIndex: locator.position.sectionIndex, offset: locator.position.end },
      endLocator ? { sectionIndex: endLocator.position.sectionIndex, offset: endLocator.position.end } : null,
      maxChars,
    );
  } else {
    slices = readBackward(
      readable,
      { sectionIndex: locator.position.sectionIndex, offset: locator.position.start },
      endLocator ? { sectionIndex: endLocator.position.sectionIndex, offset: endLocator.position.start } : null,
      maxChars,
    );
  }

  const first = slices[0] ?? null;
  const last = slices[slices.length - 1] ?? null;
  const fallbackPoint = direction === "forward"
    ? { sectionIndex: locator.position.sectionIndex, offset: locator.position.end }
    : { sectionIndex: locator.position.sectionIndex, offset: locator.position.start };
  const previousLocator = navigationBefore(document, readable, first
    ? { sectionIndex: first.section.sectionIndex, offset: first.start }
    : fallbackPoint);
  const nextLocator = navigationAfter(document, readable, last
    ? { sectionIndex: last.section.sectionIndex, offset: last.end }
    : fallbackPoint);
  const firstReadable = readable[0] ?? null;
  const lastReadable = readable[readable.length - 1] ?? null;

  return {
    slices,
    text: slices.map((item) => item.text).join(""),
    previousLocator,
    nextLocator,
    reachedSectionStart: Boolean(first && first.start === 0),
    reachedSectionEnd: Boolean(last && last.end === last.section.text.length),
    reachedBookStart: Boolean(first && firstReadable
      && first.section.sectionIndex === firstReadable.sectionIndex && first.start === 0),
    reachedBookEnd: Boolean(last && lastReadable
      && last.section.sectionIndex === lastReadable.sectionIndex && last.end === last.section.text.length),
  };
}

function readForward(
  sections: DocumentSection[],
  startPoint: Point,
  target: Point | null,
  maxChars: number,
): BookReadSlice[] {
  const result: BookReadSlice[] = [];
  let remaining = maxChars;
  for (const section of sections) {
    if (section.sectionIndex < startPoint.sectionIndex || remaining <= 0) continue;
    if (target && comparePoint({ sectionIndex: section.sectionIndex, offset: 0 }, target) >= 0) break;
    const start = section.sectionIndex === startPoint.sectionIndex ? startPoint.offset : 0;
    let end = Math.min(section.text.length, start + remaining);
    if (target?.sectionIndex === section.sectionIndex) end = Math.min(end, target.offset);
    if (end > start) {
      result.push(slice(section, start, end));
      remaining -= end - start;
    }
    if (target && comparePoint({ sectionIndex: section.sectionIndex, offset: end }, target) >= 0) break;
  }
  return result;
}

function readBackward(
  sections: DocumentSection[],
  startPoint: Point,
  target: Point | null,
  maxChars: number,
): BookReadSlice[] {
  const result: BookReadSlice[] = [];
  let remaining = maxChars;
  for (let index = sections.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const section = sections[index];
    if (section.sectionIndex > startPoint.sectionIndex) continue;
    if (target && comparePoint({ sectionIndex: section.sectionIndex, offset: section.text.length }, target) <= 0) break;
    const end = section.sectionIndex === startPoint.sectionIndex ? startPoint.offset : section.text.length;
    let start = Math.max(0, end - remaining);
    if (target?.sectionIndex === section.sectionIndex) start = Math.max(start, target.offset);
    if (end > start) {
      result.unshift(slice(section, start, end));
      remaining -= end - start;
    }
    if (target && comparePoint({ sectionIndex: section.sectionIndex, offset: start }, target) <= 0) break;
  }
  return result;
}

function navigationBefore(
  document: BookDocument,
  sections: DocumentSection[],
  point: Point,
): EpubBookLocatorV1 | null {
  if (point.offset > 0) return makeLocator(document, point.sectionIndex, point.offset, point.offset);
  const candidates = sections.filter((section) => section.sectionIndex < point.sectionIndex);
  const previous = candidates[candidates.length - 1];
  return previous
    ? makeLocator(document, previous.sectionIndex, previous.text.length, previous.text.length)
    : null;
}

function navigationAfter(
  document: BookDocument,
  sections: DocumentSection[],
  point: Point,
): EpubBookLocatorV1 | null {
  const section = document.sections.find((candidate) => candidate.sectionIndex === point.sectionIndex);
  if (section && point.offset < section.text.length) {
    return makeLocator(document, point.sectionIndex, point.offset, point.offset);
  }
  const next = sections.find((candidate) => candidate.sectionIndex > point.sectionIndex);
  return next ? makeLocator(document, next.sectionIndex, 0, 0) : null;
}

function slice(section: DocumentSection, start: number, end: number): BookReadSlice {
  return { section, start, end, text: section.text.slice(start, end) };
}

interface Point {
  sectionIndex: number;
  offset: number;
}

export function compareBookPoint(left: Point, right: Point): number {
  return comparePoint(left, right);
}

function comparePoint(left: Point, right: Point): number {
  return left.sectionIndex === right.sectionIndex
    ? left.offset - right.offset
    : left.sectionIndex - right.sectionIndex;
}
