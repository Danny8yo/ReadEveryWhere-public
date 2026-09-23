import { readerFactory } from '../../../lib/reader/factory';
import { createTOCView } from '../../../lib/foliate-js/ui/tree.js';
import type { BookFormat } from '../../../utils/bookFormat';
import type { ReaderPort } from '../domain/ReaderPort';
import type { ReaderSource, WebReaderPort } from './WebReaderPort';
/** Foliate 原始对象、DOM 挂载和 PDF renderer 能力只在 Web 宿主边界使用。 */
export function createWebReaderHost() {
    let engine: WebReaderPort | null = null;
    let disposed = false;
    function raw(): any {
        if (!engine)
            throw new Error('阅读器引擎尚未打开');
        return engine.rawView;
    }
    async function open(format: BookFormat, source: ReaderSource, container: HTMLElement, spread: string): Promise<ReaderPort> {
        if (disposed)
            throw new Error('阅读器宿主已销毁');
        const next = readerFactory.create(format);
        engine = next;
        await next.open(source, container, { prepareBook: format === 'pdf' ? book => { book.rendition = { ...book.rendition, spread }; } : undefined });
        if (disposed) {
            next.destroy();
            throw new Error('阅读器打开已取消');
        }
        return next;
    }
    function setPdfZoom(value: string | number) { raw().renderer.setAttribute('zoom', value); }
    async function setPdfSpread(spread: string, page: number) { await raw().renderer.setSpreadMode(spread, page); }
    function pageCount(): number { return raw().book.sections.length; }
    function mountToc(container: HTMLElement, reader: ReaderPort, navigate: (href: string) => void) {
        const toc = reader.getToc();
        if (toc.length === 0)
            return null;
        const view = createTOCView(toc, navigate);
        container.replaceChildren(view.element);
        return view as {
            element: HTMLElement;
            setCurrentHref(href: string): void;
        };
    }
    function dispose() { disposed = true; if (engine)
        engine.destroy(); engine = null; }
    return { open, setPdfZoom, setPdfSpread, pageCount, mountToc, dispose };
}
