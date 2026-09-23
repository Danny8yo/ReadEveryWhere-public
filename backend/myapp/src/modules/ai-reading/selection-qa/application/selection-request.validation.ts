import type {
  ContentScope,
  SelectionRequest,
} from "@readeverywhere/epub-core/types";
type BookSelectionRequest =
  | SelectionRequest
  | {
      scope: ContentScope;
      cfi: string;
      displayedQuote: string;
      source?: never;
    };
import { SelectionQaError } from "./selection-qa.types";
export function validateSelectionRequest(
  value: unknown,
  bookId: number,
): BookSelectionRequest {
  const fail = (): never => {
    throw new SelectionQaError("INVALID_SELECTION", 400);
  };
  const object = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return fail();
    const row = v as Record<string, unknown>;
    if (Object.keys(row).some((key) => !keys.includes(key))) return fail();
    return row;
  };
  const text = (v: unknown, max: number): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= max;
  const integer = (v: unknown): v is number =>
    Number.isSafeInteger(v) && Number(v) >= 0;
  const request = object(value, ["scope", "source", "cfi", "displayedQuote"]);
  const scope = object(request.scope, [
    "bookId",
    "fileChecksum",
    "extractorVersion",
    "normalizationVersion",
    "sectionIndex",
    "href",
  ]);
  if (
    scope.bookId !== bookId ||
    !integer(scope.sectionIndex) ||
    !text(scope.fileChecksum, 128) ||
    !text(scope.extractorVersion, 128) ||
    !text(scope.normalizationVersion, 128) ||
    !text(scope.href, 4000) ||
    !text(request.displayedQuote, 12000)
  )
    fail();
  if ("source" in request === "cfi" in request) fail();
  if ("cfi" in request) {
    if (!text(request.cfi, 8000)) fail();
  } else {
    const source = object(request.source, ["start", "end"]);
    for (const key of ["start", "end"]) {
      const point = object(source[key], ["path", "offset"]);
      if (
        !Array.isArray(point.path) ||
        point.path.length > 128 ||
        point.path.some((item) => !integer(item)) ||
        !integer(point.offset)
      )
        fail();
    }
  }
  return value as BookSelectionRequest;
}
