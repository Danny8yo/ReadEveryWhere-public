import type { PendingCommand } from "../model/selectionQa";
export function encodePending(
  command: PendingCommand,
  userId: number,
  bookId: number,
): string {
  return JSON.stringify({ version: 1, userId, bookId, command });
}
export function decodePending(
  raw: string,
  userId: number,
  bookId: number,
): PendingCommand {
  const fail = (): never => {
    throw new Error(
      "未确认请求记录不完整或不属于当前书籍。原记录已保留，请勿重复提交。",
    );
  };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail();
    return value as Record<string, unknown>;
  };
  const keys = (
    value: Record<string, unknown>,
    required: string[],
    optional: string[] = [],
  ) => {
    if (
      required.some((key) => !(key in value)) ||
      Object.keys(value).some(
        (key) => ![...required, ...optional].includes(key),
      )
    )
      fail();
  };
  const text = (value: unknown, max: number) =>
    typeof value === "string" && !!value.trim() && value.length <= max;
  const envelope = object(JSON.parse(raw));
  keys(envelope, ["version", "userId", "bookId", "command"]);
  if (
    envelope.version !== 1 ||
    envelope.userId !== userId ||
    envelope.bookId !== bookId
  )
    fail();
  const command = object(envelope.command),
    body = object(command.body);
  if (!text(body.commandId, 128)) fail();
  if (command.kind === "create") {
    keys(command, ["kind", "body"]);
    keys(body, ["commandId", "bookId", "selection", "question"]);
    if (body.bookId !== bookId || !text(body.question, 4000)) fail();
    const selection = object(body.selection),
      scope = object(selection.scope);
    keys(selection, ["scope", "cfi", "displayedQuote"]);
    keys(scope, [
      "bookId",
      "fileChecksum",
      "extractorVersion",
      "normalizationVersion",
      "sectionIndex",
      "href",
    ]);
    if (
      scope.bookId !== bookId ||
      !/^sha256:[a-f0-9]{64}$/.test(String(scope.fileChecksum)) ||
      !text(scope.extractorVersion, 128) ||
      !text(scope.normalizationVersion, 128) ||
      !Number.isSafeInteger(scope.sectionIndex) ||
      Number(scope.sectionIndex) < 0 ||
      !text(scope.href, 4000) ||
      !text(selection.cfi, 8000) ||
      !String(selection.cfi).startsWith("epubcfi(") ||
      !text(selection.displayedQuote, 12000)
    )
      fail();
  } else if (command.kind === "turn") {
    keys(command, ["kind", "conversationId", "body"]);
    keys(body, ["commandId", "question"], ["retryOfTurnId"]);
    if (
      !text(command.conversationId, 128) ||
      !text(body.question, 4000) ||
      (body.retryOfTurnId !== undefined && !text(body.retryOfTurnId, 128))
    )
      fail();
  } else if (command.kind === "apply") {
    keys(command, ["kind", "turnId", "body"]);
    keys(body, ["commandId", "appendText", "target"], ["answerVersion", "acceptUnverified"]);
    if (body.answerVersion !== undefined && (!Number.isSafeInteger(body.answerVersion) || Number(body.answerVersion) < 0)) fail();
    if (body.acceptUnverified !== undefined && typeof body.acceptUnverified !== "boolean") fail();
    if (!text(command.turnId, 128) || !text(body.appendText, 50000)) fail();
    const target = object(body.target);
    if (target.kind === "append") {
      keys(target, ["kind", "annotationId", "expectedRevision"]);
      if (
        !text(target.annotationId, 128) ||
        !Number.isSafeInteger(target.expectedRevision) ||
        Number(target.expectedRevision) < 1
      )
        fail();
    } else if (target.kind === "create") {
      keys(
        target,
        ["kind", "annotationType", "color", "cfi"],
        ["chapterLabel"],
      );
      if (
        !["highlight", "underline", "squiggly"].includes(
          String(target.annotationType),
        ) ||
        !text(target.color, 100) ||
        !text(target.cfi, 8000) ||
        !String(target.cfi).startsWith("epubcfi(") ||
        (target.chapterLabel !== undefined && !text(target.chapterLabel, 1000))
      )
        fail();
    } else fail();
  } else fail();
  return command as unknown as PendingCommand;
}
