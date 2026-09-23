import type { AddFromSearchParams, LibraryBook } from '../model/library';
import type { CreateDownloadTaskParams, DownloadTask } from '../model/download';
import type { Scheduler } from '../../../shared/domain/scheduler';
import { errorMessage } from '../../../shared/domain/errors';
export type AcquisitionPhase = 'adding' | 'creating' | 'downloading' | 'completed' | 'failed' | 'canceled' | 'poll_failed';
export interface AcquisitionJob {
    phase: AcquisitionPhase;
    message: string;
    bookId: number | null;
    taskId: number | null;
    generation: number;
}
export interface AcquisitionGateway {
    add(params: AddFromSearchParams): Promise<LibraryBook>;
    createTask(params: CreateDownloadTaskParams): Promise<DownloadTask>;
    getTask(id: number): Promise<DownloadTask>;
}
export const createAcquisitionState = () => ({ jobs: {} as Record<string, AcquisitionJob> });
export const isAcquisitionBusy = (job: AcquisitionJob) => ['adding', 'creating', 'downloading'].includes(job.phase);
/** 每本书一个命令；同一命令串行轮询，失败重试保留已创建的书籍和任务。 */
export function createAcquisitionController(state: ReturnType<typeof createAcquisitionState>, api: AcquisitionGateway, scheduler: Scheduler, completed: (key: string) => void) {
    let generation = 0;
    let disposed = false;
    const timers = new Map<string, number>();
    const active = (key: string, token: number) => !disposed && state.jobs[key]?.generation === token;
    function stop(key: string) {
        const timer = timers.get(key);
        if (timer !== undefined)
            scheduler.clearTimeout(timer);
        timers.delete(key);
    }
    function patch(key: string, token: number, values: Partial<AcquisitionJob>) {
        if (active(key, token))
            Object.assign(state.jobs[key], values);
    }
    async function poll(key: string, token: number, taskId: number) {
        stop(key);
        try {
            const task = await api.getTask(taskId);
            if (!active(key, token))
                return;
            switch (task.status) {
                case 'completed':
                    patch(key, token, { phase: 'completed', message: '下载完成' });
                    completed(key);
                    return;
                case 'failed':
                    patch(key, token, { phase: 'failed', message: `下载失败：${task.errorMessage || '下载任务失败'}` });
                    return;
                case 'canceled':
                    patch(key, token, { phase: 'canceled', message: '下载已取消' });
                    return;
                case 'queued':
                case 'downloading':
                    patch(key, token, { phase: 'downloading', message: `下载中 ${task.progress}%` });
                    timers.set(key, scheduler.setTimeout(() => void poll(key, token, taskId), 2000));
                    return;
                default: {
                    const status: never = task.status;
                    throw new Error(`未知下载状态：${String(status)}`);
                }
            }
        }
        catch (cause) {
            patch(key, token, { phase: 'poll_failed', message: `读取下载进度失败：${errorMessage(cause)}` });
        }
    }
    async function add(key: string, input: AddFromSearchParams) {
        if (disposed)
            throw new Error('入库会话已销毁');
        const previous = state.jobs[key];
        if (previous && (isAcquisitionBusy(previous) || previous.phase === 'completed'))
            return;
        const token = ++generation;
        stop(key);
        state.jobs[key] = {
            phase: 'adding', message: '正在加入书库...', generation: token,
            bookId: previous?.bookId ?? null,
            taskId: previous?.phase === 'poll_failed' ? previous.taskId : null,
        };
        try {
            let bookId = state.jobs[key].bookId;
            if (bookId === null) {
                const book = await api.add(input);
                if (!active(key, token))
                    return;
                bookId = book.id;
                patch(key, token, { bookId });
            }
            if (!input.sourceUrl) {
                patch(key, token, { phase: 'completed', message: '加入成功' });
                completed(key);
                return;
            }
            let taskId = state.jobs[key].taskId;
            if (taskId === null) {
                if (input.sourcePlatform !== 'zlibrary')
                    throw new Error(`不支持的下载来源：${input.sourcePlatform}`);
                patch(key, token, { phase: 'creating', message: '正在建立下载任务...' });
                const task = await api.createTask({ bookId, sourcePlatform: 'zlibrary', sourceUrl: input.sourceUrl, fileName: input.title });
                if (!active(key, token))
                    return;
                taskId = task.id;
                patch(key, token, { taskId });
            }
            patch(key, token, { phase: 'downloading', message: '下载中 0%' });
            if (taskId === null)
                throw new Error('下载任务未创建');
            const id = taskId;
            timers.set(key, scheduler.setTimeout(() => void poll(key, token, id), 2000));
        }
        catch (cause) {
            patch(key, token, { phase: 'failed', message: `${state.jobs[key].bookId === null ? '入库失败' : '建立下载任务失败'}：${errorMessage(cause)}` });
        }
    }
    function dispose() {
        disposed = true;
        for (const key of timers.keys())
            stop(key);
    }
    return { add, dispose };
}
