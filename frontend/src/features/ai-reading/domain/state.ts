import type { ReadingCitationLocator, ReadingEvent, ReadingPlanItem, ReadingTaskDetail, ReadingTaskStatus, ReadingTextQuote } from '../model/aiReading';
export interface StreamedReadingAnswer {
    answerId: string;
    text: string;
    phase: 'started' | 'streaming' | 'completed';
    mode: 'model' | 'fallback';
    evidenceIds: string[];
}
export interface ReadingEventTimelineItem {
    key: string;
    events: ReadingEvent[];
    startSequence: number;
    endSequence: number;
    modelCallId?: string;
    toolCallId?: string;
    title: string;
    summary?: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted' | 'recorded';
    createdAt: string;
}
export type CitationAttempt = {
    kind: 'cfi';
    epubcfi: string;
} | {
    kind: 'text_quote';
    sectionIndex: number;
    textQuote: ReadingTextQuote;
} | {
    kind: 'href';
    href: string;
};
const TERMINAL_STATUSES = new Set<ReadingTaskStatus>([
    'completed',
    'partial',
    'needs_input',
    'failed',
    'cancelled',
]);
export function isReadingTaskActive(status: ReadingTaskStatus): boolean {
    return !TERMINAL_STATUSES.has(status);
}
export function boundedBudgetUsage(used: number, limit: number): number {
    if (!Number.isFinite(used) || used <= 0)
        return 0;
    if (!Number.isFinite(limit) || limit <= 0)
        return used;
    return Math.min(used, limit);
}
export function mergeReadingEvents(existing: ReadingEvent[], incoming: ReadingEvent[]): ReadingEvent[] {
    const bySequence = new Map<number, ReadingEvent>();
    for (const item of existing)
        bySequence.set(item.sequence, item);
    for (const item of incoming)
        bySequence.set(item.sequence, item);
    return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}
export function streamedAnswer(events: ReadingEvent[]): StreamedReadingAnswer | null {
    const answerEvents = [...events]
        .filter((event) => event.payload.schemaVersion === 2 && event.payload.kind === 'answer')
        .sort((left, right) => left.sequence - right.sequence);
    const latestStart = [...answerEvents].reverse().find((event) => event.type === 'answer_started');
    if (!latestStart)
        return null;
    const start = latestStart.payload.detail as Record<string, unknown>;
    const answerId = typeof start.answerId === 'string' ? start.answerId : '';
    if (!answerId)
        return null;
    let text = '';
    let phase: StreamedReadingAnswer['phase'] = 'started';
    let mode: StreamedReadingAnswer['mode'] = start.mode === 'fallback' ? 'fallback' : 'model';
    let evidenceIds: string[] = [];
    for (const event of answerEvents) {
        if (event.sequence < latestStart.sequence)
            continue;
        const detail = event.payload.detail as Record<string, unknown>;
        if (detail.answerId !== answerId)
            continue;
        if (event.type === 'answer_delta' && typeof detail.delta === 'string' && Number.isSafeInteger(detail.offset)) {
            const offset = Math.max(0, Number(detail.offset));
            if (offset > text.length)
                continue;
            text = `${text.slice(0, offset)}${detail.delta}${text.slice(offset + detail.delta.length)}`;
            phase = 'streaming';
        }
        if (event.type === 'answer_completed' && typeof detail.text === 'string') {
            text = detail.text;
            phase = 'completed';
            mode = detail.mode === 'fallback' ? 'fallback' : 'model';
            evidenceIds = Array.isArray(detail.evidenceIds)
                ? detail.evidenceIds.filter((item): item is string => typeof item === 'string')
                : [];
        }
    }
    return { answerId, text, phase, mode, evidenceIds };
}
export function latestPublicPlan(task: ReadingTaskDetail | null, events: ReadingEvent[]): ReadingPlanItem[] {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type !== 'plan_updated' || event.payload.schemaVersion !== 2)
            continue;
        const detail = event.payload.detail as {
            after?: unknown;
        };
        if (!Array.isArray(detail.after))
            continue;
        const steps = detail.after.filter(isPublicPlanStep).map((step) => ({
            id: step.id,
            title: step.title,
            status: step.status,
            ...(event.agentRunId ? { agentRunId: event.agentRunId } : {}),
        }));
        if (steps.length)
            return steps;
    }
    return task?.plan ?? [];
}
export function groupReadingEvents(events: ReadingEvent[], taskStatus: ReadingTaskStatus): ReadingEventTimelineItem[] {
    const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
    const toolGroups = new Map<string, ReadingEvent[]>();
    const standalone: ReadingEvent[] = [];
    for (const event of ordered) {
        if (!event.toolCallId) {
            standalone.push(event);
            continue;
        }
        const key = toolCorrelationKey(event);
        const group = toolGroups.get(key) ?? [];
        group.push(event);
        toolGroups.set(key, group);
    }
    const assignedStandalone = new Set<number>();
    for (const event of standalone) {
        if (event.type !== 'budget_updated' || !event.modelCallId)
            continue;
        const target = [...toolGroups.values()]
            .filter((group) => group.some((item) => item.modelCallId === event.modelCallId))
            .sort((left, right) => left[0].sequence - right[0].sequence)[0];
        if (!target)
            continue;
        target.push(event);
        target.sort((left, right) => left.sequence - right.sequence);
        assignedStandalone.add(event.sequence);
    }
    const items = [
        ...[...toolGroups.entries()].map(([key, group]) => timelineItem(key, group, taskStatus)),
        ...standalone
            .filter((event) => !assignedStandalone.has(event.sequence))
            .map((event) => timelineItem(`event:${event.sequence}`, [event], taskStatus)),
    ];
    return items.sort((left, right) => left.startSequence - right.startSequence);
}
function timelineItem(key: string, events: ReadingEvent[], taskStatus: ReadingTaskStatus): ReadingEventTimelineItem {
    const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
    const started = ordered.find((event) => event.type === 'tool_started');
    const outcome = [...ordered].reverse().find((event) => (event.type === 'tool_observation' || event.type === 'evidence_imported'));
    const recovery = [...ordered].reverse().find((event) => event.type === 'recovery_attempted');
    const primary = started ?? outcome ?? recovery ?? ordered[0];
    const latestWithSummary = [...ordered].reverse().find((event) => event.payload.summary);
    const phase = outcome?.type === 'evidence_imported'
        ? 'completed'
        : outcome?.payload.schemaVersion === 2
            ? (outcome.payload.detail as {
                phase?: unknown;
            }).phase
            : undefined;
    const terminal = ['completed', 'partial', 'needs_input', 'failed', 'cancelled'].includes(taskStatus);
    const status = phase === 'failed'
        ? 'failed'
        : phase === 'completed' || (outcome && outcome.payload.schemaVersion === 1)
            ? 'completed'
            : started
                ? terminal ? 'interrupted' : 'running'
                : primary.type === 'agent_failed' || primary.type === 'task_failed'
                    ? 'failed'
                    : primary.type === 'agent_completed' || primary.type === 'task_completed'
                        ? 'completed'
                        : 'recorded';
    return {
        key,
        events: ordered,
        startSequence: ordered[0].sequence,
        endSequence: ordered.at(-1)!.sequence,
        modelCallId: primary.modelCallId,
        toolCallId: primary.toolCallId,
        title: primary.payload.title,
        summary: latestWithSummary?.payload.summary ?? primary.payload.summary,
        status,
        createdAt: ordered[0].createdAt,
    };
}
function toolCorrelationKey(event: ReadingEvent): string {
    return `tool:${event.modelCallId ?? 'unknown'}:${event.toolCallId}`;
}
function isPublicPlanStep(value: unknown): value is {
    id: string;
    title: string;
    status: ReadingPlanItem['status'];
} {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const step = value as Record<string, unknown>;
    return typeof step.id === 'string'
        && typeof step.title === 'string'
        && typeof step.status === 'string'
        && ['pending', 'in_progress', 'completed', 'failed'].includes(step.status);
}
export function buildCitationAttempts(locator: ReadingCitationLocator): CitationAttempt[] {
    const attempts: CitationAttempt[] = [];
    const epubcfi = locator.readerAnchor?.epubcfi?.trim();
    if (epubcfi)
        attempts.push({ kind: 'cfi', epubcfi });
    const sectionIndex = locator.position?.sectionIndex;
    const exact = locator.textQuote?.exact?.trim();
    if (Number.isInteger(sectionIndex) && sectionIndex >= 0 && exact) {
        attempts.push({
            kind: 'text_quote',
            sectionIndex,
            textQuote: { ...locator.textQuote!, exact },
        });
    }
    const href = locator.structure?.href?.trim();
    if (href) {
        const fragment = locator.structure?.fragment?.trim();
        attempts.push({ kind: 'href', href: fragment ? `${href}#${fragment}` : href });
    }
    return attempts;
}
export function evidenceMap(evidence: import('../model/aiReading').ReadingTaskDetail['evidence'] | import('../model/aiReading').ReadingResult['evidence']): Map<string, import('../model/aiReading').ReadingEvidence> {
    if (!evidence)
        return new Map();
    if (Array.isArray(evidence))
        return new Map(evidence.map((item) => [item.id, item]));
    return new Map(Object.entries(evidence));
}
