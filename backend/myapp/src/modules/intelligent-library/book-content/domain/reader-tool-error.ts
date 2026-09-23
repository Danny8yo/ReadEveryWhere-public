export type ReaderToolErrorCode =
  | "BOOK_NOT_FOUND"
  | "BOOK_FILE_MISSING"
  | "UNSUPPORTED_FORMAT"
  | "EXTRACTION_FAILED"
  | "CONTENT_REVISION_MISMATCH"
  | "LOCATOR_INVALID"
  | "LOCATOR_OUT_OF_RANGE"
  | "READING_TARGET_ALREADY_REACHED"
  | "TEXT_QUOTE_MISMATCH"
  | "CURSOR_INVALID"
  | "TOC_REQUEST_INVALID"
  | "TOC_NODE_NOT_FOUND"
  | "TOC_NODE_NOT_READABLE"
  | "TOC_NODE_TOO_LARGE"
  | "TOC_TREE_TOO_LARGE"
  | "REFERENCE_UNRESOLVED"
  | "QUERY_INVALID"
  | "INDEX_NOT_CONFIGURED"
  | "INDEX_RESOURCE_LIMIT"
  | "INDEX_BUILD_FAILED"
  | "INDEX_DEADLINE";

const HTTP_CODE_BY_REASON: Record<ReaderToolErrorCode, { status: number; code: number }> = {
  BOOK_NOT_FOUND: { status: 404, code: 40411 },
  BOOK_FILE_MISSING: { status: 409, code: 40911 },
  UNSUPPORTED_FORMAT: { status: 415, code: 41511 },
  EXTRACTION_FAILED: { status: 422, code: 42211 },
  CONTENT_REVISION_MISMATCH: { status: 409, code: 40912 },
  LOCATOR_INVALID: { status: 400, code: 40011 },
  LOCATOR_OUT_OF_RANGE: { status: 400, code: 40012 },
  READING_TARGET_ALREADY_REACHED: { status: 409, code: 40915 },
  TEXT_QUOTE_MISMATCH: { status: 409, code: 40913 },
  CURSOR_INVALID: { status: 400, code: 40013 },
  TOC_REQUEST_INVALID: { status: 400, code: 40015 },
  TOC_NODE_NOT_FOUND: { status: 404, code: 40412 },
  TOC_NODE_NOT_READABLE: { status: 422, code: 42213 },
  TOC_NODE_TOO_LARGE: { status: 413, code: 41311 },
  TOC_TREE_TOO_LARGE: { status: 409, code: 40914 },
  REFERENCE_UNRESOLVED: { status: 422, code: 42212 },
  QUERY_INVALID: { status: 400, code: 40014 },
  INDEX_NOT_CONFIGURED: { status: 503, code: 50311 },
  INDEX_RESOURCE_LIMIT: { status: 503, code: 50313 },
  INDEX_BUILD_FAILED: { status: 503, code: 50312 },
  INDEX_DEADLINE: { status: 408, code: 40811 },
};

export interface ReaderToolErrorDetails {
  field: string | null;
  reason: ReaderToolErrorCode;
  [key: string]: unknown;
}

export class ReaderToolException extends Error {
  readonly status: number;
  readonly code: number;
  readonly details: ReaderToolErrorDetails;

  constructor(
    reason: ReaderToolErrorCode,
    message: string,
    field: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    const mapping = HTTP_CODE_BY_REASON[reason];
    super(message);
    this.name = "ReaderToolException";
    this.status = mapping.status;
    this.code = mapping.code;
    this.details = { field, reason, ...details };
  }
}
