import { budgetPolicyForRequest } from './budget';
import { isReadingTaskActive, mergeReadingEvents } from './state';
import type { ReadingBudgetConfig, ReadingBudgetSelection, ReadingConversationDetail, ReadingConversationSummary, ReadingConversationTurnDetail, ReadingEvent, ReadingReaderFocus } from '../model/aiReading';
export interface UseReadingConversationOptions {
    pollIntervalMs?: number;
    historyPageSize?: number;
    turnPageSize?: number;
    canCreateConversation?: () => boolean;
    createBlockedMessage?: string;
}
function errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'message' in error) {
        return String((error as {
            message?: unknown;
        }).message || '请求失败');
    }
    return '请求失败';
}
import type { ReadingConversationGateway } from './ports';
import type { Scheduler } from '../../../shared/domain/scheduler';
export function createConversationState() {
    return {
        conversations: [] as ReadingConversationSummary[],
        totalConversations: 0,
        currentConversation: null as ReadingConversationDetail | null,
        turns: [] as ReadingConversationTurnDetail[],
        currentTurn: null as ReadingConversationTurnDetail | null,
        events: [] as ReadingEvent[],
        olderTurnsAvailable: false,
        nextBeforeTurnNumber: null as number | null,
        budgetConfig: null as ReadingBudgetConfig | null,
        budgetConfigLoading: false,
        budgetConfigError: null as string | null,
        loading: false,
        creating: false,
        mutating: false,
        error: null as string | null,
    };
}
export function createConversationController(state: ReturnType<typeof createConversationState>, api: ReadingConversationGateway, scheduler: Scheduler, getBookId: () => number, options: UseReadingConversationOptions = {}) {
    const derived = { get currentTurnActive() {
            return (state.currentTurn ? isReadingTaskActive(state.currentTurn.status) : false);
        },
        get currentConversationFrozen() { return state.currentConversation?.status === 'frozen'; },
        get canNavigateCitation() { return Boolean(state.currentConversation) && !derived.currentConversationFrozen; },
        get canSendTurn() {
            return (Boolean(state.currentConversation)
                && !derived.currentConversationFrozen
                && !derived.currentTurnActive
                && !state.creating
                && !state.mutating);
        } };
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const detailPollIntervalMs = Math.max(1200, pollIntervalMs);
    const historyPageSize = options.historyPageSize ?? 20;
    const turnPageSize = options.turnPageSize ?? 20;
    let pollTimer: number | null = null;
    let polling = false;
    let disposed = false;
    let selectionToken = 0;
    let lifetime = 0;
    let historyGeneration = 0;
    let lastDetailPollAt = 0;
    function clearTimer() {
        if (pollTimer !== null) {
            scheduler.clearTimeout(pollTimer);
            pollTimer = null;
        }
    }
    function schedulePoll(delay = pollIntervalMs) {
        clearTimer();
        if (disposed || !state.currentConversation || !state.currentTurn || !derived.currentTurnActive)
            return;
        pollTimer = scheduler.setTimeout(() => void pollCurrentTurn(), delay);
    }
    async function loadBudgetConfig() {
        const token = lifetime;
        state.budgetConfigLoading = true;
        state.budgetConfigError = null;
        try {
            const config = await api.getBudgetConfig();
            if (disposed || token !== lifetime)
                return null;
            state.budgetConfig = config;
            return state.budgetConfig;
        }
        catch (cause) {
            state.budgetConfigError = errorMessage(cause);
            return null;
        }
        finally {
            state.budgetConfigLoading = false;
        }
    }
    async function loadHistory() {
        const token = ++historyGeneration;
        const book = getBookId();
        state.loading = true;
        state.error = null;
        try {
            const page = await api.listConversations(getBookId(), 1, historyPageSize);
            if (disposed || token !== historyGeneration || book !== getBookId())
                return [];
            state.conversations = page.items;
            state.totalConversations = page.total;
            return page.items;
        }
        catch (cause) {
            state.error = errorMessage(cause);
            return [];
        }
        finally {
            state.loading = false;
        }
    }
    async function fetchAllNewEvents(conversationId: string, turnId: string, token: number) {
        let afterSequence = state.events.at(-1)?.sequence ?? 0;
        let hasMore = true;
        while (hasMore && token === selectionToken && !disposed) {
            const page = await api.listConversationTurnEvents(conversationId, turnId, afterSequence, 100);
            if (disposed || token !== selectionToken)
                return;
            state.events = mergeReadingEvents(state.events, page.items);
            const mergedLast = state.events.at(-1)?.sequence ?? afterSequence;
            afterSequence = Math.max(afterSequence, page.nextSequence ?? 0, mergedLast);
            hasMore = page.hasMore;
            if (page.items.length === 0 && hasMore)
                break;
        }
    }
    async function selectTurn(turnId: string, initial?: ReadingConversationTurnDetail) {
        if (!state.currentConversation)
            return;
        const conversationId = state.currentConversation.id;
        const token = ++selectionToken;
        clearTimer();
        state.loading = true;
        state.error = null;
        state.events = [];
        try {
            const rawDetail = initial ?? await api.getConversationTurn(conversationId, turnId);
            const detail = rawDetail.task ? rawDetail : await loadTurnWithTask(conversationId, rawDetail);
            if (disposed || token !== selectionToken)
                return;
            state.currentTurn = detail;
            upsertTurn(detail);
            await fetchAllNewEvents(conversationId, turnId, token);
            schedulePoll(0);
        }
        catch (cause) {
            if (!disposed && token === selectionToken)
                state.error = errorMessage(cause);
        }
        finally {
            if (!disposed && token === selectionToken)
                state.loading = false;
        }
    }
    async function selectConversation(conversationId: string) {
        const token = ++selectionToken;
        clearTimer();
        state.loading = true;
        state.error = null;
        state.currentTurn = null;
        state.events = [];
        state.turns = [];
        try {
            const [detail, page] = await Promise.all([
                api.getConversation(conversationId),
                api.listConversationTurns(conversationId, undefined, turnPageSize),
            ]);
            if (disposed || token !== selectionToken)
                return;
            const hydrated = await hydrateTurns(conversationId, page.items.length ? page.items : detail.turns ?? []);
            if (disposed || token !== selectionToken)
                return;
            state.turns = hydrated;
            state.olderTurnsAvailable = page.hasMore;
            state.nextBeforeTurnNumber = page.nextBeforeTurnNumber;
            if (!state.turns.length && detail.turns?.length) {
                state.turns = [...detail.turns].sort((left, right) => left.turnNumber - right.turnNumber);
            }
            const latest = state.turns.at(-1) ?? await loadLatestTurn(detail);
            if (disposed || token !== selectionToken)
                return;
            state.currentConversation = withLatestTurn(detail, latest ?? undefined);
            if (latest)
                await selectTurn(latest.id, latest);
        }
        catch (cause) {
            if (!disposed && token === selectionToken)
                state.error = errorMessage(cause);
        }
        finally {
            if (!disposed && token === selectionToken)
                state.loading = false;
        }
    }
    async function loadOlderTurns() {
        const token = selectionToken;
        if (!state.currentConversation || !state.olderTurnsAvailable || state.nextBeforeTurnNumber === null)
            return;
        state.loading = true;
        state.error = null;
        try {
            const page = await api.listConversationTurns(state.currentConversation.id, state.nextBeforeTurnNumber, turnPageSize);
            if (disposed || token !== selectionToken || !state.currentConversation)
                return;
            const older = await hydrateTurns(state.currentConversation.id, page.items);
            if (disposed || token !== selectionToken)
                return;
            const byId = new Map([...older, ...state.turns].map((turn) => [turn.id, turn]));
            state.turns = [...byId.values()].sort((left, right) => left.turnNumber - right.turnNumber);
            state.olderTurnsAvailable = page.hasMore;
            state.nextBeforeTurnNumber = page.nextBeforeTurnNumber;
        }
        catch (cause) {
            state.error = errorMessage(cause);
        }
        finally {
            state.loading = false;
        }
    }
    async function loadConversationPage(page?: number) {
        if (state.loading || state.conversations.length >= state.totalConversations)
            return [];
        state.loading = true;
        state.error = null;
        try {
            const result = await api.listConversations(getBookId(), Math.max(1, page ?? Math.floor(state.conversations.length / historyPageSize) + 1), historyPageSize);
            const byId = new Map([...state.conversations, ...result.items].map((item) => [item.id, item]));
            state.conversations = [...byId.values()];
            state.totalConversations = result.total;
            return result.items;
        }
        catch (cause) {
            state.error = errorMessage(cause);
            return [];
        }
        finally {
            state.loading = false;
        }
    }
    async function startConversation(message: string, budget: ReadingBudgetSelection, readerFocus?: ReadingReaderFocus) {
        if (disposed || state.creating || state.mutating)
            return null;
        const context = lifetime;
        const selection = selectionToken;
        const normalizedMessage = message.trim();
        if (!normalizedMessage)
            return null;
        if (options.canCreateConversation && !options.canCreateConversation()) {
            state.error = options.createBlockedMessage ?? '请先完成有效的 AI 预分析';
            return null;
        }
        state.creating = true;
        state.error = null;
        try {
            const budgetPolicy = budgetPolicyForRequest(budget);
            const detail = await api.createConversation({
                bookId: getBookId(),
                message: normalizedMessage,
                budgetTier: budget.budgetTier,
                ...(budgetPolicy ? { budgetPolicy } : {}),
                ...(readerFocus ? { readerFocus } : {}),
            });
            if (disposed || context !== lifetime || selection !== selectionToken)
                return null;
            state.conversations = [detail, ...state.conversations.filter((item) => item.id !== detail.id)];
            state.totalConversations += 1;
            await selectConversation(detail.id);
            return detail;
        }
        catch (cause) {
            if (!disposed && context === lifetime && selection === selectionToken)
                state.error = errorMessage(cause);
            return null;
        }
        finally {
            if (context === lifetime)
                state.creating = false;
        }
    }
    async function sendTurn(message: string, budget: ReadingBudgetSelection, readerFocus?: ReadingReaderFocus) {
        if (disposed || state.creating || state.mutating)
            return null;
        const context = lifetime;
        const selection = selectionToken;
        const normalizedMessage = message.trim();
        if (!normalizedMessage || !state.currentConversation)
            return null;
        if (derived.currentConversationFrozen) {
            state.error = '书籍内容版本已变化，请基于当前版本新建会话';
            return null;
        }
        if (derived.currentTurnActive) {
            state.error = '当前追问仍在处理中';
            return null;
        }
        state.creating = true;
        state.error = null;
        try {
            const budgetPolicy = budgetPolicyForRequest(budget);
            const result = await api.createConversationTurn(state.currentConversation.id, {
                message: normalizedMessage,
                budgetTier: budget.budgetTier,
                ...(budgetPolicy ? { budgetPolicy } : {}),
                ...(readerFocus ? { readerFocus } : {}),
            });
            if (disposed || context !== lifetime || selection !== selectionToken)
                return null;
            state.currentConversation = result.conversation;
            upsertTurn(result.turn);
            await selectTurn(result.turn.id, result.turn);
            return result.turn;
        }
        catch (cause) {
            if (!disposed && context === lifetime && selection === selectionToken)
                state.error = errorMessage(cause);
            return null;
        }
        finally {
            if (context === lifetime)
                state.creating = false;
        }
    }
    async function retryTurn(turn = state.currentTurn, message?: string) {
        if (disposed || state.creating || state.mutating)
            return null;
        const context = lifetime;
        const selection = selectionToken;
        if (!state.currentConversation || !turn || !['failed', 'cancelled'].includes(turn.status))
            return null;
        state.mutating = true;
        state.error = null;
        try {
            const result = await api.retryConversationTurn(state.currentConversation.id, turn.id, message?.trim() ? { message: message.trim() } : {});
            if (disposed || context !== lifetime || selection !== selectionToken)
                return null;
            state.currentConversation = result.conversation;
            upsertTurn(result.turn);
            await selectTurn(result.turn.id, result.turn);
            return result.turn;
        }
        catch (cause) {
            if (!disposed && context === lifetime && selection === selectionToken)
                state.error = errorMessage(cause);
            return null;
        }
        finally {
            if (context === lifetime)
                state.mutating = false;
        }
    }
    async function cancelTurn() {
        if (disposed || state.mutating)
            return undefined;
        const context = lifetime;
        const selection = selectionToken;
        if (!state.currentConversation || !state.currentTurn || !derived.currentTurnActive)
            return;
        state.mutating = true;
        state.error = null;
        try {
            const task = await api.cancelConversationTurn(state.currentConversation.id, state.currentTurn.id);
            if (disposed || context !== lifetime || selection !== selectionToken)
                return undefined;
            const detail: ReadingConversationTurnDetail = {
                ...state.currentTurn,
                status: task.status,
                task,
                updatedAt: task.updatedAt,
                finishedAt: task.completedAt ?? new Date().toISOString(),
            };
            state.currentTurn = detail;
            upsertTurn(detail);
            clearTimer();
            await fetchAllNewEvents(state.currentConversation.id, detail.id, selectionToken);
        }
        catch (cause) {
            if (!disposed && context === lifetime && selection === selectionToken)
                state.error = errorMessage(cause);
        }
        finally {
            if (context === lifetime)
                state.mutating = false;
        }
    }
    async function deleteConversation() {
        if (disposed || state.creating || state.mutating)
            return false;
        const context = lifetime;
        const selection = selectionToken;
        if (!state.currentConversation || derived.currentTurnActive)
            return false;
        state.mutating = true;
        state.error = null;
        try {
            const id = state.currentConversation.id;
            await api.deleteConversation(id);
            if (disposed || context !== lifetime || selection !== selectionToken)
                return false;
            state.conversations = state.conversations.filter((item) => item.id !== id);
            state.totalConversations = Math.max(0, state.totalConversations - 1);
            selectionToken += 1;
            state.currentConversation = null;
            state.currentTurn = null;
            state.turns = [];
            state.events = [];
            clearTimer();
            return true;
        }
        catch (cause) {
            if (!disposed && context === lifetime && selection === selectionToken)
                state.error = errorMessage(cause);
            return false;
        }
        finally {
            if (context === lifetime)
                state.mutating = false;
        }
    }
    async function pollCurrentTurn() {
        if (disposed || !state.currentConversation || !state.currentTurn)
            return;
        if (polling) {
            schedulePoll(100);
            return;
        }
        polling = true;
        const conversationId = state.currentConversation.id;
        const turnId = state.currentTurn.id;
        const token = selectionToken;
        try {
            await fetchAllNewEvents(conversationId, turnId, token);
            const latestEventType = state.events.at(-1)?.type;
            const terminalEventArrived = typeof latestEventType === 'string'
                && ['task_completed', 'task_partial', 'task_needs_input', 'task_failed', 'task_cancelled'].includes(latestEventType);
            if (!terminalEventArrived && Date.now() - lastDetailPollAt < detailPollIntervalMs)
                return;
            const [conversation, turn] = await Promise.all([
                api.getConversation(conversationId),
                api.getConversationTurn(conversationId, turnId),
            ]);
            lastDetailPollAt = Date.now();
            if (token !== selectionToken || state.currentTurn?.id !== turnId)
                return;
            const hydratedTurn = turn.task ? turn : await loadTurnWithTask(conversationId, turn);
            if (disposed || token !== selectionToken)
                return;
            const hydratedConversation = withLatestTurn(conversation, hydratedTurn);
            state.currentConversation = hydratedConversation;
            state.currentTurn = hydratedTurn;
            upsertTurn(hydratedTurn);
            state.conversations = state.conversations.map((item) => item.id === conversationId ? hydratedConversation : item);
            state.error = null;
        }
        catch (cause) {
            if (!disposed && token === selectionToken)
                state.error = errorMessage(cause);
        }
        finally {
            polling = false;
            if (!disposed && token === selectionToken)
                schedulePoll();
        }
    }
    async function refresh() {
        const selectedId = state.currentConversation?.id;
        const items = await loadHistory();
        const recover = selectedId
            ? items.find((item) => item.id === selectedId)
            : items.find((item) => item.latestTurn && isReadingTaskActive(item.latestTurn.status)) ?? items[0];
        if (recover)
            await selectConversation(recover.id);
    }
    function clearSelection() {
        lifetime++;
        historyGeneration++;
        state.creating = false;
        state.mutating = false;
        state.loading = false;
        selectionToken += 1;
        state.currentConversation = null;
        state.currentTurn = null;
        state.turns = [];
        state.events = [];
        state.olderTurnsAvailable = false;
        state.nextBeforeTurnNumber = null;
        lastDetailPollAt = 0;
        clearTimer();
    }
    function upsertTurn(detail: ReadingConversationTurnDetail) {
        const byId = new Map(state.turns.map((turn) => [turn.id, turn]));
        byId.set(detail.id, detail);
        state.turns = [...byId.values()].sort((left, right) => left.turnNumber - right.turnNumber);
    }
    function withLatestTurn(conversation: ReadingConversationDetail, turn?: ReadingConversationTurnDetail): ReadingConversationDetail {
        return turn ? { ...conversation, latestTurn: turn } : conversation;
    }
    async function hydrateTurns(conversationId: string, items: ReadingConversationTurnDetail[]): Promise<ReadingConversationTurnDetail[]> {
        const hydrated = await Promise.all(items.map((turn) => (turn.task ? turn : loadTurnWithTask(conversationId, turn))));
        return hydrated.sort((left, right) => left.turnNumber - right.turnNumber);
    }
    async function loadLatestTurn(detail: ReadingConversationDetail): Promise<ReadingConversationTurnDetail | null> {
        if (!detail.latestTurn)
            return null;
        if ('task' in detail.latestTurn)
            return detail.latestTurn as ReadingConversationTurnDetail;
        return loadTurnWithTask(detail.id, detail.latestTurn);
    }
    async function loadTurnWithTask(conversationId: string, turn: ReadingConversationTurnDetail): Promise<ReadingConversationTurnDetail> {
        const detail = await api.getConversationTurn(conversationId, turn.id);
        if (!detail.task)
            throw new Error('Conversation turn detail is missing its task');
        return detail;
    }
    function dispose() { disposed = true; clearSelection(); }
    async function changeBook() { clearSelection(); state.conversations = []; await refresh(); }
    return { derived, loadBudgetConfig, loadHistory, loadConversationPage, selectConversation, selectTurn, loadOlderTurns, startConversation, sendTurn, retryTurn, cancelTurn, deleteConversation, clearSelection, refresh, dispose, changeBook };
}
