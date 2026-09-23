export type ReadingBudgetTier = 'quick' | 'standard' | 'deep';
export type ReadingBudgetMode = 'preset' | 'custom';
export interface ReadingBudgetPolicy {
    maxModelTurns: number;
    maxToolCalls: number;
    maxReadCharacters: number;
    maxDurationMs: number;
    maxDelegatedAgents: number;
    maxConcurrentAgents: number;
}
export type ReadingBudgetPolicyField = keyof ReadingBudgetPolicy;
export interface ReadingBudgetConstraint {
    min: number;
    max: number;
    step: number;
}
export interface ReadingBudgetConfig {
    version: 1 | 2;
    presets: Record<ReadingBudgetTier, ReadingBudgetPolicy>;
    constraints: Record<ReadingBudgetPolicyField, ReadingBudgetConstraint>;
    executionLimits?: {
        maxDelegationDepth: number;
        maxChildrenPerAgent: number;
        maxDelegatedAgentsPerDepth: number;
        maxActiveTurns: number;
        maxActiveAgentRuns: number;
        childMaxModelTurns: number;
        childMaxToolCalls: number;
        childMaxReadCharacters: number;
        childMaxExecutionMs: number;
    };
}
export interface ReadingBudgetSelection {
    budgetTier: ReadingBudgetTier;
    budgetMode: ReadingBudgetMode;
    budgetPolicy: ReadingBudgetPolicy;
}
export type ReadingTaskStatus = 'queued' | 'running' | 'completed' | 'partial' | 'needs_input' | 'failed' | 'cancelled';
export type ReadingAgentRunStatus = ReadingTaskStatus | 'waiting_children';
export type ReadingPlanStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export interface AiModelConfig {
    provider: 'deepseek';
    displayName: 'DeepSeek-V4-flash' | string;
    modelId: string;
    hasApiKey: boolean;
    updatedAt: string | null;
}
export interface TestAiModelConfigResult {
    ok: boolean;
    modelId: string;
    latencyMs: number;
    errorCode?: string;
}
export interface ContentRevision {
    fileChecksum: string;
    extractorVersion: string;
    normalizationVersion: string;
}
export interface ReadingTextQuote {
    exact: string;
    prefix?: string;
    suffix?: string;
}
export interface ReadingCitationLocator {
    version: 1;
    bookId: number;
    contentRevision: ContentRevision;
    position: {
        kind: 'epub_text';
        sectionIndex: number;
        start: number;
        end: number;
    };
    textQuote?: ReadingTextQuote;
    structure?: {
        tocNodeId?: string;
        href?: string;
        fragment?: string;
        label?: string;
        path?: string;
    };
    readerAnchor?: {
        epubcfi?: string;
    };
}
export interface ReadingCitation {
    bookId: number;
    bookTitle: string;
    authors: string[];
    chapterPath: string | null;
    locator: ReadingCitationLocator;
    annotationId?: string | null;
}
export interface ReadingEvidence {
    id: string;
    quote: string;
    citation: ReadingCitation;
}
export interface ReadingResultItem {
    id: string;
    statement: string;
    evidenceIds: string[];
}
export interface ReadingResult {
    answerText?: string;
    bookFindings: ReadingResultItem[];
    inferences: ReadingResultItem[];
    modelKnowledge: ReadingResultItem[];
    openQuestions: Array<string | ReadingResultItem>;
    limitations: Array<string | ReadingResultItem>;
    evidence?: ReadingEvidence[] | Record<string, ReadingEvidence>;
}
export interface ReadingPlanItem {
    id: string;
    title: string;
    status: ReadingPlanStatus;
    agentRunId?: string;
}
export interface ReadingAgentRun {
    id: string;
    parentRunId: string | null;
    kind: 'root' | 'subagent';
    depth?: number;
    goal: string;
    deliverable?: string;
    status: ReadingAgentRunStatus;
    usage?: Partial<BudgetCounters> & TokenUsage;
    limits?: Partial<BudgetCounters>;
    terminalReason?: string | null;
}
export interface BudgetCounters {
    modelTurns: number;
    toolCalls: number;
    readCharacters: number;
    durationMs: number;
    delegatedAgents: number;
    concurrentAgents: number;
}
export interface ReadingBudget {
    limits: BudgetCounters;
    used: BudgetCounters & TokenUsage;
    remaining: BudgetCounters;
}
export interface ReadingTaskSummary {
    id: string;
    bookId: number;
    goal: string;
    budgetTier: ReadingBudgetTier;
    budgetMode: ReadingBudgetMode;
    status: ReadingTaskStatus;
    createdAt: string;
    updatedAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
}
export interface ReadingTaskDetail extends ReadingTaskSummary {
    contentRevision: ContentRevision;
    plan: ReadingPlanItem[];
    agents: ReadingAgentRun[];
    budget: ReadingBudget;
    result: ReadingResult | null;
    evidence?: ReadingEvidence[] | Record<string, ReadingEvidence>;
}
export type ReadingEventType = 'task_queued' | 'task_started' | 'task_resumed' | 'plan_updated' | 'agent_queued' | 'agent_started' | 'agent_waiting_children' | 'agent_resumed' | 'agent_progress' | 'agent_completed' | 'agent_failed' | 'tool_started' | 'tool_observation' | 'evidence_recorded' | 'evidence_imported' | 'answer_started' | 'answer_delta' | 'answer_completed' | 'budget_updated' | 'recovery_attempted' | 'task_completed' | 'task_partial' | 'task_needs_input' | 'task_failed' | 'task_cancelled';
export type PublicReadingEventKind = 'task' | 'plan' | 'agent' | 'commentary' | 'tool' | 'evidence' | 'answer' | 'budget' | 'recovery';
export interface PublicPlanStep {
    id: string;
    title: string;
    status: ReadingPlanStatus;
}
export interface PublicTaskDetail {
    status?: string;
    goal?: string;
    reasonCode?: string;
    budgetTier?: ReadingBudgetTier;
    budgetMode?: ReadingBudgetMode;
    budgetPolicy?: Partial<ReadingBudgetPolicy>;
    truncated?: true;
}
export interface PublicPlanDetail {
    before: PublicPlanStep[];
    after: PublicPlanStep[];
    nextAction?: string;
    truncated?: true;
}
export interface PublicAgentDetail {
    role?: 'root' | 'subagent';
    goal?: string;
    status?: string;
    parentRunId?: string;
    findingCount?: number;
    evidenceIds?: string[];
    errorCode?: string;
    truncated?: true;
}
export interface PublicToolDetail {
    phase: 'started' | 'completed' | 'failed';
    purpose?: string;
    arguments?: Record<string, unknown>;
    result?: Record<string, unknown>;
    evidenceIds?: string[];
    durationMs?: number;
    errorCode?: string;
    retryable?: boolean;
    recoveryAction?: string;
    truncated?: true;
}
export interface PublicEvidenceDetail {
    quote?: string;
    chapterPath?: string;
    citation?: ReadingCitation;
    truncated?: true;
}
export interface PublicAnswerDetail {
    phase: 'started' | 'streaming' | 'completed';
    answerId: string;
    mode?: 'model' | 'fallback';
    offset?: number;
    delta?: string;
    text?: string;
    characterCount?: number;
    evidenceIds?: string[];
}
export interface PublicCommentaryDetail {
    phase: 'completed';
    text: string;
    truncated?: true;
}
export interface PublicBudgetDetail {
    cause?: 'model_call' | 'tool_call' | 'delegation' | 'recovery';
    delta?: Partial<BudgetCounters>;
    callDurationMs?: number;
    remaining?: Partial<BudgetCounters>;
    exhaustedBy?: string[];
    truncated?: true;
}
export interface PublicRecoveryDetail {
    errorCode?: string;
    retryable?: boolean;
    recoveryAction?: string;
    attempt?: number;
    relatedAgentRunId?: string;
    truncated?: true;
}
export type PublicReadingEventDetail = PublicTaskDetail | PublicPlanDetail | PublicAgentDetail | PublicCommentaryDetail | PublicToolDetail | PublicEvidenceDetail | PublicAnswerDetail | PublicBudgetDetail | PublicRecoveryDetail | {
    truncated: true;
};
export interface PublicReadingEventPayloadV2 {
    schemaVersion: 2;
    kind: PublicReadingEventKind;
    title: string;
    summary?: string;
    toolName?: string;
    truncated?: boolean;
    detail: PublicReadingEventDetail;
}
export interface LegacyPublicReadingEventPayload {
    schemaVersion: 1;
    legacy: true;
    kind: PublicReadingEventKind;
    title: string;
    summary?: string;
    toolName?: string;
    detail: {
        unavailable: true;
    };
}
export type PublicReadingEventPayload = PublicReadingEventPayloadV2 | LegacyPublicReadingEventPayload;
export interface ReadingEvent {
    sequence: number;
    type: ReadingEventType | string;
    createdAt: string;
    agentRunId: string | null;
    parentRunId: string | null;
    payload: PublicReadingEventPayload;
    stepId?: string;
    modelCallId?: string;
    toolCallId?: string;
    evidenceId?: string;
}
export interface ReadingEventPage {
    items: ReadingEvent[];
    nextSequence: number;
    hasMore: boolean;
}
export interface ReadingReaderFocus {
    sectionIndex: number;
    chapterLabel?: string;
}
export type ReadingConversationStatus = 'active' | 'frozen';
export type ReadingConversationTurnStatus = ReadingTaskStatus;
export interface TokenUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cacheReadInputTokens?: number | null;
    cacheWriteInputTokens?: number | null;
    uncachedInputTokens?: number | null;
}
export interface ReadingConversationSummary {
    id: string;
    bookId: number;
    rootGoal: string;
    status: ReadingConversationStatus;
    contentRevision: ContentRevision;
    createdAt: string;
    updatedAt: string;
    frozenAt?: string | null;
    frozenReason?: string | null;
    profileSnapshot?: Record<string, unknown>;
    latestTurn?: ReadingConversationTurnSummary | null;
    usage?: TokenUsage;
}
export interface ReadingConversationDetail extends ReadingConversationSummary {
    profileId?: string;
    strategyVersion?: string;
    turns?: ReadingConversationTurnDetail[];
}
export interface ReadingConversationTurnSummary {
    id: string;
    conversationId: string;
    taskId: string;
    turnNumber: number;
    userInput: string;
    status: ReadingConversationTurnStatus;
    retryOfTurnId?: string | null;
    retrySource?: {
        sourceTurnId: string;
        sourceStatus: 'failed' | 'cancelled';
        failureCode: string;
        evidenceCandidates: Array<{
            sourceEvidenceId: string;
            chapterPath: string | null;
            quotePreview: string;
        }>;
    } | null;
    readerFocus?: ReadingReaderFocus | null;
    createdAt: string;
    updatedAt: string;
    finishedAt?: string | null;
    clarificationQuestion?: string | null;
}
export interface ReadingConversationTurnDetail extends ReadingConversationTurnSummary {
    task?: ReadingTaskDetail;
}
export interface ReadingConversationPage {
    items: ReadingConversationSummary[];
    total: number;
    page: number;
    pageSize: number;
}
export interface ReadingConversationTurnPage {
    items: ReadingConversationTurnDetail[];
    nextBeforeTurnNumber: number | null;
    hasMore: boolean;
}
export interface SaveAiModelConfigPayload {
    apiKey?: string;
    modelId?: string;
}
export interface CreateReadingConversationPayload {
    bookId: number;
    message: string;
    budgetTier: ReadingBudgetTier;
    budgetPolicy?: ReadingBudgetPolicy;
    readerFocus?: ReadingReaderFocus;
}
export interface CreateReadingConversationTurnPayload {
    message: string;
    budgetTier: ReadingBudgetTier;
    budgetPolicy?: ReadingBudgetPolicy;
    readerFocus?: ReadingReaderFocus;
}
export interface ReadingConversationMutationResult {
    conversation: ReadingConversationDetail;
    turn: ReadingConversationTurnDetail;
}
export interface RetryReadingConversationTurnPayload {
    message?: string;
    budgetTier?: ReadingBudgetTier;
    budgetPolicy?: ReadingBudgetPolicy;
    readerFocus?: ReadingReaderFocus;
}
