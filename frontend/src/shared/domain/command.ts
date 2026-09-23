import { errorMessage } from './errors';
export type CommandResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
} | {
    ok: false;
    cancelled: true;
};
export const createCommandState = () => ({ busy: false, error: null as string | null });
/** 简单异步命令共用重复提交与生命周期保护；业务状态转换留在 feature controller。 */
export function createCommandController(state: ReturnType<typeof createCommandState>) {
    let generation = 0;
    let disposed = false;
    async function run<T>(operation: () => Promise<T>): Promise<CommandResult<T>> {
        if (disposed || state.busy)
            return { ok: false, cancelled: true };
        const token = ++generation;
        state.busy = true;
        state.error = null;
        try {
            const value = await operation();
            if (disposed || token !== generation)
                return { ok: false, cancelled: true };
            return { ok: true, value };
        }
        catch (cause) {
            if (disposed || token !== generation)
                return { ok: false, cancelled: true };
            const error = errorMessage(cause);
            state.error = error;
            return { ok: false, error };
        }
        finally {
            if (token === generation)
                state.busy = false;
        }
    }
    function reset() { generation++; state.busy = false; state.error = null; }
    function dispose() { disposed = true; reset(); }
    return { run, reset, dispose };
}
