import { markdownText } from '../../../shared/domain/markdown';
import type {
  LoadedEpubIdentity,
  EpubSelectionAnchor,
  SelectionRequest,
  Turn,
  QaEvent,
  ValidatedLocation,
} from "../model/selectionQa";
export function selectionRequest(
  bookId: number,
  identity: LoadedEpubIdentity | null,
  anchor: EpubSelectionAnchor,
): SelectionRequest {
  if (
    !identity ||
    !identity.extractorVersion ||
    !identity.normalizationVersion ||
    !/^sha256:[a-f0-9]{64}$/.test(identity.fileChecksum)
  )
    throw new Error("当前 EPUB 文件身份尚未确认，请重新打开书籍。");
  if (
    !Number.isSafeInteger(anchor.sectionIndex) ||
    anchor.sectionIndex < 0 ||
    !anchor.href ||
    !anchor.cfi.startsWith("epubcfi(") ||
    !anchor.displayedQuote.trim() ||
    anchor.displayedQuote.length > 12000
  )
    throw new Error("选区无法精确定位，或超过 12000 字符，请重新选择。");
  return {
    scope: {
      bookId,
      fileChecksum: identity.fileChecksum,
      extractorVersion: identity.extractorVersion,
      normalizationVersion: identity.normalizationVersion,
      sectionIndex: anchor.sectionIndex,
      href: anchor.href,
    },
    cfi: anchor.cfi,
    displayedQuote: anchor.displayedQuote,
  };
}
export function assertLoadedScope(
  bookId: number,
  identity: LoadedEpubIdentity | null,
  scope: {
    bookId: number;
    fileChecksum: string;
    extractorVersion: string;
    normalizationVersion: string;
  },
): void {
  if (!identity)
    throw new Error(
      "当前浏览器尚未验证实际 EPUB 文件，问答暂不可用；历史记录仍可查看。",
    );
  if (
    scope.bookId !== bookId ||
    scope.fileChecksum !== identity.fileChecksum ||
    scope.extractorVersion !== identity.extractorVersion ||
    scope.normalizationVersion !== identity.normalizationVersion
  )
    throw new Error(
      "已加载文件与此会话版本不一致，请重新打开书籍后再提问。历史记录仍可查看。",
    );
}
export function verifyLoadedLocation(
  bookId: number,
  identity: LoadedEpubIdentity | null,
  location: ValidatedLocation,
): string {
  if (
    !identity ||
    location.scope.bookId !== bookId ||
    location.artifact.bookId !== bookId ||
    location.scope.fileChecksum !== identity.fileChecksum ||
    location.artifact.fileChecksum !== identity.fileChecksum ||
    location.scope.extractorVersion !== identity.extractorVersion ||
    location.scope.normalizationVersion !== identity.normalizationVersion
  )
    throw new Error("书籍内容版本已变化，请重新打开书籍。旧问答仅供查看。");
  if (typeof location.cfi !== "string" || !location.cfi.startsWith("epubcfi("))
    throw new Error("服务器未返回有效的原文位置。");
  return location.cfi;
}
export function reduceEvent(
  turn: Turn,
  event: QaEvent,
): "applied" | "duplicate" | "gap" {
  if (
    event.schemaVersion !== 1 ||
    event.turnId !== turn.id ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1
  )
    throw new Error("问答流协议不一致。");
  if (event.sequence <= turn.lastSequence) return "duplicate";
  if (!["queued", "running"].includes(turn.status))
    throw new Error("终态问答不能继续接收新事件。");
  if (event.sequence !== turn.lastSequence + 1) return "gap";
  const data = event.data;
  if (event.kind === "answer_delta") {
    if (typeof data.text !== "string") throw new Error("问答文本事件无效。");
    turn.answer += data.text;
  } else if (event.kind === "citation") {
    const evidence = data.evidence as Turn["citations"][number];
    if (
      !evidence ||
      typeof evidence.evidenceId !== "string" ||
      typeof evidence.quote !== "string"
    )
      throw new Error("引用事件无效。");
    if (!turn.citations.some((e) => e.evidenceId === evidence.evidenceId))
      turn.citations.push(evidence);
  } else if (event.kind === "status") {
    if (data.status !== "queued" && data.status !== "running")
      throw new Error("问答状态事件无效。");
    turn.status = data.status;
    if (typeof data.phase === "string") {
      turn.phase = data.phase;
      if (typeof data.at === 'number') {
        turn.process ??= [];
        turn.process.push({ sequence: event.sequence, at: data.at, phase: data.phase, detail: data });
      }
    }
  } else if (event.kind === "terminal") {
    if (
      !["completed", "cancelled", "failed", "timed_out"].includes(
        String(data.status),
      ) ||
      typeof data.answer !== "string"
    )
      throw new Error("问答终态事件无效。");
    turn.status = data.status as Turn["status"];
    turn.answer = data.answer;
    turn.errorCode = typeof data.reason === "string" ? data.reason : null;
    turn.phase = "terminal";
  } else throw new Error("未知问答事件。");
  turn.lastSequence = event.sequence;
  return "applied";
}
export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "citation"; id: string; label: string };
export function answerParts(turn: Turn): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const pattern = /\[\[evidence:([^\]]+)\]\]/g;
  let offset = 0;
  for (const match of turn.answer.matchAll(pattern)) {
    const index = match.index!;
    if (index > offset)
      parts.push({ kind: "text", text: turn.answer.slice(offset, index) });
    const n = turn.citations.findIndex((e) => e.evidenceId === match[1]);
    parts.push(
      n < 0
        ? { kind: "text", text: "[引用尚未验证]" }
        : { kind: "citation", id: match[1], label: `[${n + 1}]` },
    );
    offset = index + match[0].length;
  }
  if (offset < turn.answer.length)
    parts.push({ kind: "text", text: turn.answer.slice(offset) });
  return parts;
}
export function plainAnswer(turn: Turn, text = turn.answer): string {
  return text.replace(/\[\[evidence:([^\]]+)\]\]/g, (_match, id: string) => {
    const index = turn.citations.findIndex((e) => e.evidenceId === id);
    return index < 0 ? "[引用未验证]" : `[来源 ${index + 1}]`;
  });
}

export function renderedAnswer(turn: Turn): string {
  return markdownText(answerParts(turn)
    .map((part) => (part.kind === "text" ? part.text : part.label))
    .join(""));
}
