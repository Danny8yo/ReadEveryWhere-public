/** 后端错误对象与 Error 使用同一可见消息入口，不把失败伪装为成功数据。 */
export function errorMessage(cause: unknown): string {
    if (cause instanceof Error)
        return cause.message;
    if (typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string')
        return cause.message;
    return `请求失败：${String(cause)}`;
}
