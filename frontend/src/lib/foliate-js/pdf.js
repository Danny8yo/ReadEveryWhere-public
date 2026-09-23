const pdfjsPath = path => `${import.meta.env.BASE_URL}pdfjs/${path}`
const PDF_RANGE_CHUNK_SIZE = 256 * 1024

import { createPrefetchedRangeSource } from '../reader/pdfRangeSource'
import './vendor/pdfjs/pdf.mjs'
const pdfjsLib = globalThis.pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsPath('pdf.worker.mjs')

// Import CSS as raw strings (bypasses Vite HMR transformation)
// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/text_layer_builder.css
import textLayerBuilderCSS from './vendor/pdfjs/text_layer_builder.css?raw'
// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/annotation_layer_builder.css
import annotationLayerBuilderCSS from './vendor/pdfjs/annotation_layer_builder.css?raw'

// Renders of the same page overlap: the container's ResizeObserver and a `zoom`
// attribute change both re-enter `render()` for the same document, and each
// `await` below yields to the other run. Stamp every run and let a superseded
// one bail out before it touches the DOM — otherwise both write the text layer
// and the annotation CFIs, which resolve by node index, land on the wrong spans.
const renderTokens = new WeakMap()

const render = async (page, doc, zoom, index) => {
    const token = (renderTokens.get(doc) ?? 0) + 1
    renderTokens.set(doc, token)
    const superseded = () => renderTokens.get(doc) !== token

    const scale = zoom * devicePixelRatio
    doc.documentElement.style.transform = `scale(${1 / devicePixelRatio})`
    doc.documentElement.style.transformOrigin = 'top left'
    doc.documentElement.style.setProperty('--scale-factor', scale)
    const viewport = page.getViewport({ scale })

    // the canvas must be in the `PDFDocument`'s `ownerDocument`
    // (`globalThis.document` by default); that's where the fonts are loaded
    const canvas = document.createElement('canvas')
    canvas.height = viewport.height
    canvas.width = viewport.width
    const canvasContext = canvas.getContext('2d')
    await page.render({ canvasContext, viewport }).promise
    if (superseded()) return
    doc.querySelector('#canvas').replaceChildren(doc.adoptNode(canvas))
    const width = `${viewport.width}px`
    const height = `${viewport.height}px`
    for (const selector of ['#canvas', '.annotation-highlight-layer', '.textLayer', '.annotationLayer'])
        Object.assign(doc.querySelector(selector).style, { width, height })

    const container = doc.querySelector('.textLayer')
    const textContentSource = await page.streamTextContent()
    if (superseded()) return
    // pdf.js's TextLayer only appends; nothing else clears this container, so a
    // re-render would stack a second copy of every span on top of the previous
    // scale's spans.
    container.replaceChildren()
    const textLayer = new pdfjsLib.TextLayer({ textContentSource, container, viewport })
    await textLayer.render()
    if (superseded()) return

    // hide "offscreen" canvases appended to docuemnt when rendering text layer
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/pdf_viewer.css#L51-L58
    for (const canvas of document.querySelectorAll('.hiddenCanvasElement'))
        Object.assign(canvas.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '0',
            height: '0',
            display: 'none',
        })

    // fix text selection
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/text_layer_builder.js#L105-L107
    const endOfContent = document.createElement('div')
    endOfContent.className = 'endOfContent'
    container.append(endOfContent)
    // TODO: this only works in Firefox; see https://github.com/mozilla/pdf.js/pull/17923
    container.onpointerdown = () => container.classList.add('selecting')
    container.onpointerup = () => container.classList.remove('selecting')

    const div = doc.querySelector('.annotationLayer')
    const linkService = {
        goToDestination: () => {},
        getDestinationHash: dest => JSON.stringify(dest),
        addLinkAttributes: (link, url) => link.href = url,
    }
    const annotations = await page.getAnnotations()
    if (superseded()) return
    div.replaceChildren()
    await new pdfjsLib.AnnotationLayer({ page, viewport, div, linkService })
        .render({ annotations })
    if (superseded()) return

    doc.dispatchEvent(new CustomEvent('pdf-page-ready', {
        detail: { index }
    }))
}

const renderPage = async (page, index, getImageBlob) => {
    const viewport = page.getViewport({ scale: 1 })
    if (getImageBlob) {
        const canvas = document.createElement('canvas')
        canvas.height = viewport.height
        canvas.width = viewport.width
        const canvasContext = canvas.getContext('2d')
        await page.render({ canvasContext, viewport }).promise
        return new Promise(resolve => canvas.toBlob(resolve))
    }
    const src = URL.createObjectURL(new Blob([`
        <!DOCTYPE html>
        <html lang="en">
        <meta charset="utf-8">
        <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
        <style>
        html, body {
            margin: 0;
            padding: 0;
        }
        /*
        https://github.com/mozilla/pdf.js/commit/bd05b255fabfc313b194bfe9a17ccded4d90fb5a
        */
        :root {
          --user-unit: 1;
          --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
          --scale-round-x: 1px;
          --scale-round-y: 1px;
        }
        ${textLayerBuilderCSS}
        ${annotationLayerBuilderCSS}
        .annotation-highlight-layer {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }
        .annotation-highlight {
            position: absolute;
            background: var(--color);
            opacity: 0.35;
            pointer-events: none;
            mix-blend-mode: multiply;
        }
        .annotation-highlight--note {
            opacity: 0.32;
            border-bottom: 2px solid var(--color);
            border-radius: 2px;
        }
        .annotation-highlight--focused {
            outline: 2px solid rgba(17, 24, 39, 0.8);
            outline-offset: 2px;
        }
        .annotation-note-marker {
            position: absolute;
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: var(--color);
            border: 2px solid white;
            box-shadow: 0 1px 4px rgba(17, 24, 39, 0.25);
            transform: translate(4px, -4px);
            pointer-events: none;
        }
        </style>
        <div id="canvas"></div>
        <div class="annotation-highlight-layer"></div>
        <div class="textLayer"></div>
        <div class="annotationLayer"></div>
    `], { type: 'text/html' }))
    const onZoom = ({ doc, scale }) => render(page, doc, scale, index)
    return { src, onZoom }
}

const makeTOCItem = item => ({
    label: item.title,
    href: JSON.stringify(item.dest),
    subitems: item.items.length ? item.items.map(makeTOCItem) : null,
})

export const makePDF = async file => {
    // 走到这里的远端 PDF 一定是「按需分块」那一档：要不要整份下载由 BookReader 在拿到
    // 文件大小时就决定了（lib/reader/pdfLoadStrategy.ts），整份走的是带进度和 IndexedDB
    // 缓存的 File 路径。
    const source = typeof file === 'string'
        ? {
            // 开书前并发预取文件头和文件尾，把 pdf.js 的串行往返压到最少
            // （原因见 lib/reader/pdfRangeSource.ts）。
            ...await createPrefetchedRangeSource(file, {
                createTransport: (length, initialData) =>
                    new pdfjsLib.PDFDataRangeTransport(length, initialData),
            }),
            disableStream: true,
            disableAutoFetch: true,
            rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
        }
        : createFileRangeSource(file)
    const pdf = await pdfjsLib.getDocument({
        ...source,
        cMapUrl: pdfjsPath('cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: pdfjsPath('standard_fonts/'),
        wasmUrl: pdfjsPath('wasm/'),
        isEvalSupported: false,
    }).promise

    const book = { rendition: { layout: 'pre-paginated' } }

    const { metadata, info } = await pdf.getMetadata() ?? {}
    // TODO: for better results, parse `metadata.getRaw()`
    book.metadata = {
        title: metadata?.get('dc:title') ?? info?.Title,
        author: metadata?.get('dc:creator') ?? info?.Author,
        contributor: metadata?.get('dc:contributor'),
        description: metadata?.get('dc:description') ?? info?.Subject,
        language: metadata?.get('dc:language'),
        publisher: metadata?.get('dc:publisher'),
        subject: metadata?.get('dc:subject'),
        identifier: metadata?.get('dc:identifier'),
        source: metadata?.get('dc:source'),
        rights: metadata?.get('dc:rights'),
    }

    const outline = await pdf.getOutline()
    book.toc = outline?.map(makeTOCItem)

    const cache = new Map()
    book.sections = Array.from({ length: pdf.numPages }).map((_, i) => ({
        id: i,
        load: async () => {
            const cached = cache.get(i)
            if (cached) return cached
            const url = await renderPage(await pdf.getPage(i + 1), i)
            cache.set(i, url)
            return url
        },
        size: 1000,
    }))
    book.isExternal = uri => /^\w+:/i.test(uri)
    book.resolveHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return { index }
    }
    book.splitTOCHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return [index, null]
    }
    book.getTOCFragment = doc => doc.documentElement
    book.getCover = async () => renderPage(await pdf.getPage(1), null, true)
    book.destroy = () => pdf.destroy()
    return book
}

const createFileRangeSource = file => {
    const transport = new pdfjsLib.PDFDataRangeTransport(file.size, [])
    transport.requestDataRange = (begin, end) => {
        file.slice(begin, end).arrayBuffer().then(chunk => {
            transport.onDataRange(begin, chunk)
        })
    }
    return { range: transport }
}
