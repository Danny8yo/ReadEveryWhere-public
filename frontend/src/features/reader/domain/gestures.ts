import type { ReaderTapEvent } from './ReaderPort';
/** 以阅读容器为基准，热区不随正文列宽或 iframe 的分页位移变化。 */
export function toRelativeX(viewportX: number, containerLeft: number, containerWidth: number): number | null {
    if (!Number.isFinite(containerWidth) || containerWidth <= 0)
        return null;
    return (viewportX - containerLeft) / containerWidth;
}
export function edgeTapWidth(containerWidth: number): number {
    return Math.min(80, Math.max(40, containerWidth * 0.1));
}
/** 窄边缘保留翻页热区，其余有效正文区域显隐工具栏。RTL 只反转翻页方向。 */
export function resolveTapSide(rel: number, rtl: boolean, containerWidth: number): ReaderTapEvent['side'] {
    if (!Number.isFinite(rel) || rel < 0 || rel > 1 || !Number.isFinite(containerWidth) || containerWidth <= 0)
        return 'body';
    const edge = edgeTapWidth(containerWidth) / containerWidth;
    if (rel <= edge)
        return rtl ? 'next' : 'prev';
    if (rel >= 1 - edge)
        return rtl ? 'prev' : 'next';
    return 'center';
}
