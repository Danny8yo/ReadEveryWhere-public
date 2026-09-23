import { createHash } from "node:crypto";

interface ModelLocator {
  version: 1;
  position: {
    kind: "epub_text";
    sectionIndex: number;
    start: number;
    end: number;
  };
}

export interface ReadingStateFinding {
  statement: string;
  evidenceIds: string[];
}

export interface ReadingStateSectionDigest {
  sectionIndex: number;
  start: number;
  end: number;
  digest: string;
  evidenceIds: string[];
}

export interface CoveredReadingRange {
  sectionIndex: number;
  start: number;
  end: number;
  chapterPath: string | null;
}

export interface RollingReadingCoverage {
  totalCharacters: number;
  readCallCount: number;
  segmentCount: number;
  coveredSectionCount: number;
  firstRange: CoveredReadingRange | null;
  latestRange: CoveredReadingRange | null;
  recentRanges: CoveredReadingRange[];
}

export interface RollingReadingCheckpoint {
  tocRead?: {
    selectionId: string;
    processedUnits: number;
    readChars: number;
    contiguousFromStart: boolean;
    unavailableUnits: number;
    unavailableChars: number;
    pending: boolean;
    complete: boolean;
  };
  rootGoal: string;
  currentPlan: unknown[];
  targetStartLocator: ModelLocator | null;
  targetEndLocator: ModelLocator | null;
  currentContinuation: {
    previous: ModelLocator | null;
    next: ModelLocator | null;
  };
  continuationPending: boolean;
  direction: "forward" | "backward";
  coverage: RollingReadingCoverage;
  findings: ReadingStateFinding[];
  sectionDigests: ReadingStateSectionDigest[];
  openQuestions: string[];
  budget: unknown;
  retainedEvidenceIds: string[];
  exploration?: {
    structureSeen: boolean;
    locatorSeen: boolean;
    flatTocHasMore: boolean | null;
    flatTocNextCursor: string | null;
    treeSeen: boolean;
    recentCalls: Array<{ name: string; fingerprint: string }>;
  };
}

interface CreateReadingStateInput {
  rootGoal: string;
  currentPlan: unknown[];
  budget: unknown;
}

interface ModelMemoryUpdate {
  findings: ReadingStateFinding[];
  sectionDigests?: ReadingStateSectionDigest[];
  openQuestions: string[];
}

export class RollingReadingState {
  static readonly MAX_CHECKPOINT_CHARACTERS = 20_000;
  static readonly MAX_FINDINGS = 10;
  static readonly MAX_SECTION_DIGESTS = 6;
  static readonly MAX_OPEN_QUESTIONS = 6;
  static readonly MAX_EVIDENCE_IDS_PER_MEMORY = 4;
  static readonly MAX_RETAINED_EVIDENCE_IDS = 48;
  static readonly MAX_RECENT_RANGES = 6;

  private constructor(private value: RollingReadingCheckpoint) {}

  static create(input: CreateReadingStateInput): RollingReadingState {
    return new RollingReadingState({
      rootGoal: boundedText(input.rootGoal, 2_000),
      currentPlan: compactPlan(input.currentPlan),
      targetStartLocator: null,
      targetEndLocator: null,
      currentContinuation: { previous: null, next: null },
      continuationPending: false,
      direction: "forward",
      coverage: emptyCoverage(),
      findings: [],
      sectionDigests: [],
      openQuestions: [],
      budget: compactBudget(input.budget),
      retainedEvidenceIds: [],
      exploration: {
        structureSeen: false,
        locatorSeen: false,
        flatTocHasMore: null,
        flatTocNextCursor: null,
        treeSeen: false,
        recentCalls: [],
      },
    });
  }

  static fromCheckpoint(value: RollingReadingCheckpoint): RollingReadingState {
    const findings = cloneFindings(value.findings);
    const sectionDigests = cloneSectionDigests(value.sectionDigests);
    const promotedEvidenceIds = retainedEvidenceIds(findings, sectionDigests);
    const recentEvidenceIds = boundedEvidenceSample(
      uniqueStrings(value.retainedEvidenceIds).filter((evidenceId) => !promotedEvidenceIds.includes(evidenceId)),
      RollingReadingState.MAX_RETAINED_EVIDENCE_IDS - promotedEvidenceIds.length,
    );
    const state = new RollingReadingState({
      rootGoal: boundedText(value.rootGoal, 2_000),
      currentPlan: compactPlan(value.currentPlan),
      targetStartLocator: minimumLocator(value.targetStartLocator),
      targetEndLocator: minimumLocator(value.targetEndLocator),
      currentContinuation: {
        previous: minimumLocator(value.currentContinuation?.previous),
        next: minimumLocator(value.currentContinuation?.next),
      },
      continuationPending: value.continuationPending === true,
      direction: value.direction === "backward" ? "backward" : "forward",
      coverage: cloneCoverage(value.coverage),
      ...(value.tocRead ? { tocRead: clone(value.tocRead) } : {}),
      findings,
      sectionDigests,
      openQuestions: boundedStrings(value.openQuestions, RollingReadingState.MAX_OPEN_QUESTIONS, 400),
      budget: compactBudget(value.budget),
      retainedEvidenceIds: [...promotedEvidenceIds, ...recentEvidenceIds],
      exploration: {
        structureSeen: value.exploration?.structureSeen === true,
        locatorSeen: value.exploration?.locatorSeen === true,
        flatTocHasMore: optionalBoolean(value.exploration?.flatTocHasMore),
        flatTocNextCursor: boundedOptionalText(value.exploration?.flatTocNextCursor, 2_048),
        treeSeen: value.exploration?.treeSeen === true,
        recentCalls: cloneExplorationCalls(value.exploration?.recentCalls),
      },
    });
    state.assertBounded();
    return state;
  }

  recordNavigation(outputValue: unknown): void {
    const output = asRecord(outputValue);
    const entries = Array.isArray(output.entries) ? output.entries.map(asRecord) : [];
    const firstStart = entries.map((entry) => minimumLocator(entry.startLocator)).find(Boolean) ?? null;
    const lastEnd = [...entries].reverse().map((entry) => minimumLocator(entry.endLocator)).find(Boolean) ?? null;
    if (firstStart) this.value.targetStartLocator = firstStart;
    if (lastEnd) this.value.targetEndLocator = lastEnd;
    if (!this.value.currentContinuation.next && firstStart) this.value.currentContinuation.next = firstStart;
    if (firstStart || lastEnd) {
      const exploration = this.value.exploration;
      this.value.exploration = {
        structureSeen: true,
        locatorSeen: true,
        flatTocHasMore: exploration?.flatTocHasMore ?? null,
        flatTocNextCursor: exploration?.flatTocNextCursor ?? null,
        treeSeen: exploration?.treeSeen === true,
        recentCalls: exploration?.recentCalls ?? [],
      };
    }
    this.assertBounded();
  }

  recordBookRead(input: { output: unknown; evidenceIds: string[] }): void {
    const ranges = readRanges(input.output);
    const output = asRecord(input.output);
    const continuation = asRecord(output.continuation);
    if (Array.isArray(output.units)) {
      const coverage = asRecord(output.coverage);
      const count = output.units.length + output.unavailable.length;
      const from = coverage.processedUnits - count;
      const prior = this.value.tocRead;
      const continues = prior && prior.selectionId === coverage.selectionId && prior.processedUnits === from;
      const contiguousFromStart = from === 0 || Boolean(continues && prior.contiguousFromStart);
      const readChars = (continues ? prior.readChars : 0) + output.text.length;
      this.value.tocRead = {
        selectionId: coverage.selectionId, processedUnits: coverage.processedUnits, readChars,
        contiguousFromStart, unavailableUnits: coverage.unavailableUnits, unavailableChars: coverage.unavailableChars,
        pending: continuation.next !== null,
        complete: contiguousFromStart && continuation.next === null && coverage.unavailableUnits === 0 && readChars === coverage.totalChars,
      };
    }
    this.value.currentContinuation = {
      previous: Object.prototype.hasOwnProperty.call(continuation, "previous")
        ? minimumLocator(asRecord(continuation.previous).locator)
        : minimumLocator(output.previousLocator),
      next: Object.prototype.hasOwnProperty.call(continuation, "next")
        ? minimumLocator(asRecord(continuation.next).locator)
        : minimumLocator(output.nextLocator),
    };
    if (!this.value.targetStartLocator && ranges[0]) {
      this.value.targetStartLocator = locator(ranges[0].sectionIndex, ranges[0].start, ranges[0].start);
    }
    for (const range of ranges) this.recordCoverageRange(range);
    if (ranges.length > 0) {
      const exploration = this.value.exploration;
      this.value.exploration = {
        structureSeen: true,
        locatorSeen: true,
        flatTocHasMore: exploration?.flatTocHasMore ?? null,
        flatTocNextCursor: exploration?.flatTocNextCursor ?? null,
        treeSeen: exploration?.treeSeen === true,
        recentCalls: exploration?.recentCalls ?? [],
      };
    }
    this.value.coverage.readCallCount += 1;
    this.value.coverage.segmentCount += ranges.length;
    const activeContinuation = this.value.direction === "forward"
      ? this.value.currentContinuation.next
      : this.value.currentContinuation.previous;
    this.value.continuationPending = Array.isArray(output.units)
      ? continuation.next !== null
      : Boolean(activeContinuation && this.isBeforeTarget(activeContinuation));
    this.retainRecentEvidence(input.evidenceIds);
    this.assertBounded();
  }

  resolveReadingIntent(input: {
    locator: unknown;
    endLocator?: unknown;
    direction: "forward" | "backward";
  }): {
    locator: ModelLocator;
    endLocator: ModelLocator | null;
    direction: "forward" | "backward";
    resumed: boolean;
  } {
    const requestedLocator = minimumLocator(input.locator);
    if (!requestedLocator) throw new Error("READING_STATE_LOCATOR_INVALID");
    if (this.value.continuationPending && this.sameReadingIntent(input)) {
      const continuation = this.value.direction === "forward"
        ? this.value.currentContinuation.next
        : this.value.currentContinuation.previous;
      if (continuation) {
        return {
          locator: clone(continuation),
          endLocator: clone(this.value.targetEndLocator),
          direction: this.value.direction,
          resumed: true,
        };
      }
    }
    return {
      locator: requestedLocator,
      endLocator: minimumLocator(input.endLocator),
      direction: input.direction,
      resumed: false,
    };
  }

  recordReadingIntent(input: {
    locator: unknown;
    endLocator?: unknown;
    direction: "forward" | "backward";
    resumed?: boolean;
  }): void {
    const start = minimumLocator(input.locator);
    const end = minimumLocator(input.endLocator);
    if (!start) throw new Error("READING_STATE_LOCATOR_INVALID");
    if (input.resumed) {
      this.assertBounded();
      return;
    }
    this.value.targetStartLocator = start;
    this.value.targetEndLocator = end;
    this.value.direction = input.direction;
    this.value.continuationPending = true;
    this.assertBounded();
  }

  updateModelMemory(update: ModelMemoryUpdate, ownedEvidenceIds: ReadonlySet<string>): void {
    if (
      update.findings.length > RollingReadingState.MAX_FINDINGS
      || (update.sectionDigests?.length ?? 0) > RollingReadingState.MAX_SECTION_DIGESTS
      || update.openQuestions.length > RollingReadingState.MAX_OPEN_QUESTIONS
    ) throw new Error("READING_STATE_LIMIT_EXCEEDED");
    const findings = cloneFindings(update.findings);
    const sectionDigests = cloneSectionDigests(update.sectionDigests);
    for (const memory of [...findings, ...sectionDigests]) {
      if (memory.evidenceIds.length > RollingReadingState.MAX_EVIDENCE_IDS_PER_MEMORY) {
        throw new Error("READING_STATE_LIMIT_EXCEEDED");
      }
      for (const evidenceId of memory.evidenceIds) {
        if (!ownedEvidenceIds.has(evidenceId)) {
          throw new Error(`READING_STATE_EVIDENCE_NOT_OWNED: ${evidenceId}`);
        }
      }
    }
    const retained = retainedEvidenceIds(findings, sectionDigests);
    if (retained.length > RollingReadingState.MAX_RETAINED_EVIDENCE_IDS) {
      throw new Error("READING_STATE_LIMIT_EXCEEDED");
    }
    const recent = boundedEvidenceSample(
      this.value.retainedEvidenceIds.filter((evidenceId) => !retained.includes(evidenceId)),
      RollingReadingState.MAX_RETAINED_EVIDENCE_IDS - retained.length,
    );

    const candidate: RollingReadingCheckpoint = {
      ...this.value,
      findings,
      sectionDigests,
      openQuestions: boundedStrings(update.openQuestions, RollingReadingState.MAX_OPEN_QUESTIONS, 400),
      retainedEvidenceIds: [...retained, ...recent],
    };
    if (JSON.stringify(candidate).length > RollingReadingState.MAX_CHECKPOINT_CHARACTERS) {
      throw new Error("READING_STATE_LIMIT_EXCEEDED");
    }
    this.value = candidate;
  }

  updatePlan(
    steps: unknown[],
    replacementReason?: string,
  ): void {
    const incoming = compactPlan(steps);
    if (this.value.currentPlan.length === 0) {
      this.value.currentPlan = incoming;
      this.assertBounded();
      return;
    }
    const incomingById = new Map(incoming.map((step) => [String(asRecord(step).id), asRecord(step)]));
    const merged = this.value.currentPlan.map((raw) => {
      const current = asRecord(raw);
      const next = incomingById.get(String(current.id));
      if (!next) throw new Error("READING_PLAN_BASELINE_VIOLATION");
      const titleChanged = next.title !== current.title;
      if (titleChanged && !replacementReason?.trim()) {
        throw new Error("READING_PLAN_BASELINE_VIOLATION");
      }
      if (!monotonicPlanStatus(String(current.status), String(next.status))) {
        throw new Error("READING_PLAN_BASELINE_VIOLATION");
      }
      incomingById.delete(String(current.id));
      return {
        ...current,
        title: titleChanged ? next.title : current.title,
        status: next.status,
        ...(titleChanged ? { replacementReason: boundedText(replacementReason, 1_000) } : {}),
      };
    });
    this.value.currentPlan = [...merged, ...incomingById.values()].slice(0, 20);
    this.assertBounded();
  }

  evaluateExploration(toolName: string, args: unknown): { allowed: true } | {
    allowed: false;
    errorCode: string;
    suggestedAction: string;
  } {
    const phase = this.explorationPhase();
    if (["book_toc_navigation", "book_read_from_toc", "book_search_text", "book_list_annotations"].includes(toolName)
      && phase === "structure") {
      return {
        allowed: false,
        errorCode: "READING_STRUCTURE_REQUIRED",
        suggestedAction: "Inspect book_toc or book_toc_tree before locating evidence.",
      };
    }
    if (toolName === "book_read" && phase !== "read") {
      return {
        allowed: false,
        errorCode: phase === "structure" ? "READING_STRUCTURE_REQUIRED" : "READING_LOCATOR_REQUIRED",
        suggestedAction: phase === "structure"
          ? "Inspect structure, then read a selected node or obtain a locator through search."
          : "Use book_read_from_toc, book_search_text, or an exact annotation to obtain readable evidence.",
      };
    }
    if (toolName === "book_read") {
      const range = requestedReadRange(args);
      if (range && this.covered(range)) {
        return {
          allowed: false,
          errorCode: "READING_RANGE_ALREADY_COVERED",
          suggestedAction: "Use retained evidence or choose an uncovered range for verification.",
        };
      }
    }
    const repeated = this.value.exploration?.recentCalls.some((item) => (
      item.name === toolName && item.fingerprint === explorationFingerprint(toolName, args)
    ));
    if (!repeated) return { allowed: true };
    if (toolName === "book_toc" || toolName === "book_toc_tree" || toolName === "book_toc_navigation") {
      return {
        allowed: false,
        errorCode: "READING_REPEAT_TOC",
        suggestedAction: "Reuse the existing structure or select a new node/cursor.",
      };
    }
    if (toolName === "book_search_text") {
      return {
        allowed: false,
        errorCode: "READING_REPEAT_SEARCH",
        suggestedAction: "Reuse the existing hits, advance the cursor, or change the query.",
      };
    }
    if (toolName === "book_read" || toolName === "book_read_from_toc") {
      return {
        allowed: false,
        errorCode: "READING_RANGE_ALREADY_COVERED",
        suggestedAction: "Use retained evidence or choose an uncovered range for verification.",
      };
    }
    return { allowed: true };
  }

  recordExploration(toolName: string, args: unknown, _output: unknown): void {
    if (!["book_toc", "book_toc_tree", "book_toc_navigation", "book_read_from_toc", "book_search_text", "book_read"].includes(toolName)) return;
    const call = { name: toolName, fingerprint: explorationFingerprint(toolName, args) };
    const recent = (this.value.exploration?.recentCalls ?? [])
      .filter((item) => item.name !== call.name || item.fingerprint !== call.fingerprint);
    const output = asRecord(_output);
    const structureSeen = this.value.exploration?.structureSeen === true
      || toolName === "book_toc"
      || toolName === "book_toc_tree";
    const locatorSeen = this.value.exploration?.locatorSeen === true
      || (toolName === "book_toc_navigation" && containsNavigationLocator(output))
      || (toolName === "book_search_text" && containsSearchLocator(output))
      || (toolName === "book_read_from_toc" && containsReadSegment(output))
      || (toolName === "book_read" && containsReadSegment(output));
    const current = this.value.exploration;
    const reportedFlatTocHasMore = optionalBoolean(output.hasMore);
    const flatTocHasMore = toolName === "book_toc"
      ? reportedFlatTocHasMore ?? current?.flatTocHasMore ?? null
      : current?.flatTocHasMore ?? null;
    const flatTocNextCursor = toolName === "book_toc"
      ? (reportedFlatTocHasMore === true
        ? boundedOptionalText(output.nextCursor, 2_048)
        : reportedFlatTocHasMore === false ? null : current?.flatTocNextCursor ?? null)
      : current?.flatTocNextCursor ?? null;
    this.value.exploration = {
      structureSeen,
      locatorSeen,
      flatTocHasMore,
      flatTocNextCursor,
      treeSeen: current?.treeSeen === true || toolName === "book_toc_tree",
      recentCalls: [...recent, call].slice(-24),
    };
    this.assertBounded();
  }

  explorationPhase(): "structure" | "locate" | "read" {
    if (this.value.exploration?.locatorSeen === true) return "read";
    if (this.value.exploration?.structureSeen === true) return "locate";
    return "structure";
  }

  isExplorationToolAvailable(toolName: string): boolean {
    if (toolName === "book_toc") return this.value.exploration?.flatTocHasMore !== false;
    if (toolName === "book_toc_tree") return this.value.exploration?.treeSeen !== true;
    return true;
  }

  forkForGoal(rootGoal: string, budget: unknown): RollingReadingState {
    const fork = RollingReadingState.create({ rootGoal, currentPlan: [], budget });
    fork.value.exploration = {
      structureSeen: this.value.exploration?.structureSeen === true,
      locatorSeen: this.value.exploration?.locatorSeen === true,
      flatTocHasMore: this.value.exploration?.flatTocHasMore ?? null,
      flatTocNextCursor: this.value.exploration?.flatTocNextCursor ?? null,
      treeSeen: this.value.exploration?.treeSeen === true,
      recentCalls: [],
    };
    fork.assertBounded();
    return fork;
  }

  refresh(currentPlan: unknown[], budget: unknown): void {
    if (this.value.currentPlan.length === 0 && currentPlan.length > 0) {
      this.value.currentPlan = compactPlan(currentPlan);
    }
    this.value.budget = compactBudget(budget);
    this.assertBounded();
  }

  hasContinuation(): boolean {
    if (!this.value.continuationPending) return false;
    const next = this.value.direction === "forward"
      ? this.value.currentContinuation.next
      : this.value.currentContinuation.previous;
    const target = this.value.targetEndLocator;
    if (!next) return false;
    if (!target) return true;
    return this.value.direction === "forward"
      ? compareLocator(next, target) < 0
      : compareLocator(next, target) > 0;
  }

  targetEndLocator(): ModelLocator | null {
    return clone(this.value.targetEndLocator);
  }

  isCompletedReadingIntent(input: {
    locator: unknown;
    endLocator?: unknown;
    direction: "forward" | "backward";
  }): boolean {
    if (
      this.value.continuationPending
      || this.value.coverage.readCallCount === 0
      || !this.value.targetStartLocator
    ) return false;
    const start = minimumLocator(input.locator);
    const end = minimumLocator(input.endLocator) ?? this.value.targetEndLocator;
    if (!start || input.direction !== this.value.direction) return false;
    return sameLocator(start, this.value.targetStartLocator)
      && sameNullableLocator(end, this.value.targetEndLocator);
  }

  toCheckpoint(): RollingReadingCheckpoint {
    this.assertBounded();
    return clone(this.value);
  }

  private isBeforeTarget(continuation: ModelLocator): boolean {
    const target = this.value.targetEndLocator;
    if (!target) return true;
    return this.value.direction === "forward"
      ? compareLocator(continuation, target) < 0
      : compareLocator(continuation, target) > 0;
  }

  private sameReadingIntent(input: {
    locator: unknown;
    endLocator?: unknown;
    direction: "forward" | "backward";
  }): boolean {
    if (input.direction !== this.value.direction) return false;
    const requestedStart = minimumLocator(input.locator);
    const requestedEnd = minimumLocator(input.endLocator);
    if (!requestedStart || !sameNullableLocator(requestedEnd, this.value.targetEndLocator)) return false;
    const continuation = this.value.direction === "forward"
      ? this.value.currentContinuation.next
      : this.value.currentContinuation.previous;
    return Boolean(this.value.targetStartLocator && sameLocator(requestedStart, this.value.targetStartLocator))
      || Boolean(continuation && sameLocator(requestedStart, continuation));
  }

  private covered(range: CoveredReadingRange): boolean {
    return this.value.coverage.recentRanges.some((covered) => (
      covered.sectionIndex === range.sectionIndex
      && covered.start <= range.start
      && covered.end >= range.end
    ));
  }

  private retainRecentEvidence(incomingEvidenceIds: string[]): void {
    const promoted = retainedEvidenceIds(this.value.findings, this.value.sectionDigests);
    const candidates = uniqueStrings([
      ...this.value.retainedEvidenceIds.filter((evidenceId) => !promoted.includes(evidenceId)),
      ...incomingEvidenceIds.filter((evidenceId) => !promoted.includes(evidenceId)),
    ]);
    const recent = boundedEvidenceSample(
      candidates,
      RollingReadingState.MAX_RETAINED_EVIDENCE_IDS - promoted.length,
    );
    this.value.retainedEvidenceIds = [...promoted, ...recent];
  }

  private recordCoverageRange(incoming: CoveredReadingRange): void {
    const coverage = this.value.coverage;
    coverage.totalCharacters += Math.max(0, incoming.end - incoming.start);
    if (!coverage.firstRange) coverage.firstRange = clone(incoming);
    const previous = coverage.latestRange;
    if (!previous || previous.sectionIndex !== incoming.sectionIndex) coverage.coveredSectionCount += 1;
    coverage.latestRange = clone(incoming);

    const recent = coverage.recentRanges.map(clone);
    const latest = recent[recent.length - 1];
    if (
      latest
      && latest.sectionIndex === incoming.sectionIndex
      && latest.chapterPath === incoming.chapterPath
      && incoming.start <= latest.end
    ) {
      latest.end = Math.max(latest.end, incoming.end);
    } else {
      recent.push(clone(incoming));
    }
    coverage.recentRanges = recent.slice(-RollingReadingState.MAX_RECENT_RANGES);
  }

  private assertBounded(): void {
    if (JSON.stringify(this.value).length > RollingReadingState.MAX_CHECKPOINT_CHARACTERS) {
      throw new Error("READING_STATE_LIMIT_EXCEEDED");
    }
  }
}

function emptyCoverage(): RollingReadingCoverage {
  return {
    totalCharacters: 0,
    readCallCount: 0,
    segmentCount: 0,
    coveredSectionCount: 0,
    firstRange: null,
    latestRange: null,
    recentRanges: [],
  };
}

function cloneCoverage(value: unknown): RollingReadingCoverage {
  const record = asRecord(value);
  return {
    totalCharacters: nonNegativeInteger(record.totalCharacters),
    readCallCount: nonNegativeInteger(record.readCallCount ?? record.batchCount),
    segmentCount: nonNegativeInteger(record.segmentCount ?? record.underlyingReadCount),
    coveredSectionCount: nonNegativeInteger(record.coveredSectionCount),
    firstRange: readingRange(record.firstRange),
    latestRange: readingRange(record.latestRange),
    recentRanges: Array.isArray(record.recentRanges)
      ? record.recentRanges.map(readingRange).filter((range): range is CoveredReadingRange => range !== null)
        .slice(-RollingReadingState.MAX_RECENT_RANGES)
      : [],
  };
}

function readRanges(value: unknown): CoveredReadingRange[] {
  const output = asRecord(value);
  const segments = Array.isArray(output.segments) ? output.segments : [];
  return segments
    .map(asRecord)
    .map((segment) => {
      const citation = asRecord(segment.citation);
      const citationLocator = minimumLocator(citation.locator);
      if (!citationLocator) return null;
      return {
        sectionIndex: citationLocator.position.sectionIndex,
        start: citationLocator.position.start,
        end: citationLocator.position.end,
        chapterPath: typeof citation.chapterPath === "string" ? boundedText(citation.chapterPath, 240) : null,
      };
    })
    .filter((range): range is CoveredReadingRange => range !== null);
}

function readingRange(value: unknown): CoveredReadingRange | null {
  const record = asRecord(value);
  if (
    !isNonNegativeInteger(record.sectionIndex)
    || !isNonNegativeInteger(record.start)
    || !isNonNegativeInteger(record.end)
    || record.end < record.start
  ) return null;
  return {
    sectionIndex: record.sectionIndex,
    start: record.start,
    end: record.end,
    chapterPath: typeof record.chapterPath === "string" ? boundedText(record.chapterPath, 240) : null,
  };
}

function minimumLocator(value: unknown): ModelLocator | null {
  const record = asRecord(value);
  const position = asRecord(record.position);
  if (
    record.version !== 1
    || position.kind !== "epub_text"
    || !isNonNegativeInteger(position.sectionIndex)
    || !isNonNegativeInteger(position.start)
    || !isNonNegativeInteger(position.end)
    || position.end < position.start
  ) return null;
  return locator(position.sectionIndex, position.start, position.end);
}

function locator(sectionIndex: number, start: number, end: number): ModelLocator {
  return { version: 1, position: { kind: "epub_text", sectionIndex, start, end } };
}

function cloneFindings(value: unknown): ReadingStateFinding[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      statement: boundedText(record.statement, 500),
      evidenceIds: uniqueStrings(record.evidenceIds),
    };
  }).filter((finding) => finding.statement.length > 0);
}

function cloneSectionDigests(value: unknown): ReadingStateSectionDigest[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      sectionIndex: nonNegativeInteger(record.sectionIndex),
      start: nonNegativeInteger(record.start),
      end: nonNegativeInteger(record.end),
      digest: boundedText(record.digest, 500),
      evidenceIds: uniqueStrings(record.evidenceIds),
    };
  }).filter((digest) => digest.digest.length > 0 && digest.end >= digest.start);
}

function retainedEvidenceIds(
  findings: ReadingStateFinding[],
  sectionDigests: ReadingStateSectionDigest[],
): string[] {
  return uniqueStrings([
    ...findings.flatMap((finding) => finding.evidenceIds),
    ...sectionDigests.flatMap((digest) => digest.evidenceIds),
  ]);
}

function boundedEvidenceSample(evidenceIds: string[], maxItems: number): string[] {
  if (maxItems <= 0) return [];
  if (evidenceIds.length <= maxItems) return [...evidenceIds];
  if (maxItems === 1) return [evidenceIds[evidenceIds.length - 1]];
  return Array.from({ length: maxItems }, (_, index) => (
    evidenceIds[Math.round(index * (evidenceIds.length - 1) / (maxItems - 1))]
  ));
}

function compactPlan(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    const record = asRecord(item);
    return {
      id: boundedText(record.id, 80),
      title: boundedText(record.title ?? record.description, 240),
      status: boundedText(record.status, 40) || "pending",
    };
  });
}

function monotonicPlanStatus(current: string, next: string): boolean {
  const rank: Record<string, number> = { pending: 0, in_progress: 1, completed: 2, failed: 2 };
  if (!(current in rank) || !(next in rank)) return false;
  if (rank[next] < rank[current]) return false;
  return rank[current] !== 2 || current === next;
}

function cloneExplorationCalls(value: unknown): Array<{ name: string; fingerprint: string }> {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item) => (
    typeof item.name === "string" && typeof item.fingerprint === "string"
  )).slice(-24).map((item) => ({
    name: boundedText(item.name, 80),
    fingerprint: boundedText(item.fingerprint, 64),
  }));
}

function explorationFingerprint(toolName: string, args: unknown): string {
  const record = asRecord(args);
  const relevant = toolName === "book_read"
    ? { locator: record.locator, endLocator: record.endLocator, direction: record.direction ?? "forward" }
    : record;
  return createHash("sha256").update(stableJson(relevant)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function requestedReadRange(value: unknown): CoveredReadingRange | null {
  const input = asRecord(value);
  const start = minimumLocator(input.locator);
  const end = minimumLocator(input.endLocator);
  if (!start || !end || start.position.sectionIndex !== end.position.sectionIndex) return null;
  return {
    sectionIndex: start.position.sectionIndex,
    start: Math.min(start.position.start, end.position.start),
    end: Math.max(start.position.end, end.position.end),
    chapterPath: null,
  };
}

function containsNavigationLocator(output: Record<string, any>): boolean {
  return Array.isArray(output.entries) && output.entries.some((entry) => {
    const value = asRecord(entry);
    return Boolean(minimumLocator(value.startLocator) || minimumLocator(value.endLocator));
  });
}

function containsSearchLocator(output: Record<string, any>): boolean {
  return Array.isArray(output.hits) && output.hits.some((hit) => (
    Boolean(minimumLocator(asRecord(asRecord(hit).citation).locator))
  ));
}

function containsReadSegment(output: Record<string, any>): boolean {
  return Array.isArray(output.segments) && output.segments.some((segment) => (
    Boolean(minimumLocator(asRecord(asRecord(segment).citation).locator))
  ));
}

function compactBudget(value: unknown): unknown {
  const record = asRecord(value);
  return {
    used: compactNumericRecord(record.used),
    remaining: compactNumericRecord(record.remaining),
    elapsedMs: nonNegativeInteger(record.elapsedMs),
    exhaustedBy: boundedStrings(record.exhaustedBy, 8, 80),
  };
}

function compactNumericRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(asRecord(value))
    .filter(([, item]) => typeof item === "number" && Number.isFinite(item))
    .slice(0, 12)
    .map(([key, item]) => [boundedText(key, 80), Number(item)]));
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number): string[] {
  return uniqueStrings(value).slice(0, maxItems).map((item) => boundedText(item, maxLength));
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function boundedOptionalText(value: unknown, maxLength: number): string | null {
  const text = boundedText(value, maxLength);
  return text || null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function compareLocator(left: ModelLocator, right: ModelLocator): number {
  if (left.position.sectionIndex !== right.position.sectionIndex) {
    return left.position.sectionIndex - right.position.sectionIndex;
  }
  return left.position.end - right.position.end;
}

function sameLocator(left: ModelLocator, right: ModelLocator): boolean {
  return left.version === right.version
    && left.position.kind === right.position.kind
    && left.position.sectionIndex === right.position.sectionIndex
    && left.position.start === right.position.start
    && left.position.end === right.position.end;
}

function sameNullableLocator(left: ModelLocator | null, right: ModelLocator | null): boolean {
  if (!left || !right) return left === right;
  return sameLocator(left, right);
}

function nonNegativeInteger(value: unknown): number {
  return isNonNegativeInteger(value) ? value : 0;
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
