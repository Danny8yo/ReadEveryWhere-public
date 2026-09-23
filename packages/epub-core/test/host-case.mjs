import * as core from '../src/index.js'
import * as CFI from '../src/foliate/epubcfi.js'
import { EPUB } from '../src/foliate/epub.js'
import { resourcesFor } from './fixtures.mjs'

function tree(node) {
    return { type: node.nodeType, name: node.nodeName, ns: node.namespaceURI ?? null,
        text: node.nodeType === 3 || node.nodeType === 4 ? node.nodeValue : null,
        children: Array.from(node.childNodes, tree) }
}
function snapshot(document) {
    if (document.querySelector('parsererror')) return { parsererror: true }
    const map = core.buildSourceMap(document)
    return { tree: tree(document.body), text: map.text, segments: map.segments.toJSON() }
}
export async function runCase(fixture, loadRendered) {
    const resources = resourcesFor(fixture, fixture.toc ?? 'nav')
    const epub = await new EPUB({
        loadText: async path => Object.hasOwn(resources, path) ? resources[path] : null,
        loadBlob: async path => {
            if (!Object.hasOwn(resources, path)) throw new Error(`Unknown fixture resource: ${path}`)
            return new Blob([resources[path]])
        },
        getSize: path => Object.hasOwn(resources, path) ? new TextEncoder().encode(resources[path]).length : 0,
    }).init()
    const canonical = core.parseChapter(fixture.source, fixture.mediaType, new DOMParser())
    const before = await epub.sections[0].createDocument()
    const output = { id: fixture.id, canonical: snapshot(canonical.document), before: snapshot(before),
        sections: epub.sections.map(s => ({ id: s.id, linear: s.linear })), toc: epub.toc }
    // Uses real Foliate Loader.loadReplaced() and actual browser document loading.
    try {
        const url = await epub.sections[0].load()
        const response = await fetch(url)
        const markup = await response.text()
        const contentType = response.headers.get('content-type')
        output.contentType = contentType
        output.serialized = markup
        const mediaType = contentType.split(';')[0]
        const rendered = await loadRendered(url, markup, mediaType)
        if (fixture.id === 'render-resources') {
            if (!rendered.querySelector('link').getAttribute('href').startsWith('blob:')
                || !rendered.querySelector('#first').getAttribute('style').includes('blob:'))
                throw new Error('Production resource replacement was not exercised')
        }
        output.rendered = snapshot(rendered)
        output.after = snapshot(await epub.sections[0].createDocument())
        if (fixture.selection) {
            const gold = fixture.selection
            const source = { start: { path: core.addressOf(rendered.querySelector(gold.selector).firstChild), offset: gold.start },
                end: { path: core.addressOf(rendered.querySelector(gold.selector).firstChild), offset: gold.end } }
            const map = core.buildSourceMap(canonical.document)
            const canonicalRange = core.sourceToCanonical(map, source)
            const restored = core.rangeFromSource(rendered, core.canonicalToSource(map, canonicalRange))
            const oldRange = CFI.toRange(rendered, CFI.parse(gold.oldCFI))
            const scope = { bookId: 1, fileChecksum: 'sha256:fixture', extractorVersion: 'experiment',
                normalizationVersion: core.NORMALIZATION_VERSION, sectionIndex: 0, href: 'OPS/chapter.xhtml' }
            const verified = core.resolveSelection(canonical.document, map, scope,
                { scope, source, displayedQuote: gold.quote })
            output.selection = { verified, canonicalRange, restoredQuote: restored.toString(), cfi: CFI.fromRange(restored),
                oldQuote: oldRange.toString(), oldStart: core.addressOf(oldRange.startContainer) }
        }
    } catch (error) {
        // Test report preserves failures; caller marks gate failed, never an empty success.
        output.renderError = { name: error.name, message: error.message }
    } finally { epub.sections.forEach(section => section.unload()) }
    return output
}

// Boundary regression: incoming non-UTF-8 bytes are decoded by the supplied
// adapter, while a transform hook returning bytes retains its declared charset.
export async function runEncodingCase(mode, loadRendered) {
    const bytes = new Uint8Array([...new TextEncoder().encode('<html><head><title>Latin</title></head><body><p>caf'),
        0xe9, ...new TextEncoder().encode('</p></body></html>')])
    const decoded = new TextDecoder('windows-1252', { fatal: true }).decode(bytes)
    const fixture = { source: decoded, mediaType: 'text/html' }
    const resources = resourcesFor(fixture)
    const epub = await new EPUB({
        loadText: async path => Object.hasOwn(resources, path) ? resources[path] : null,
        loadBlob: async path => {
            if (!Object.hasOwn(resources, path)) throw new Error(`Unknown resource ${path}`)
            return new Blob([resources[path]])
        },
        getSize: path => Object.hasOwn(resources, path) ? resources[path].length : 0,
    }).init()
    if (mode === 'raw-transform') epub.transformTarget.addEventListener('data', event => {
        if (event.detail.name === 'OPS/chapter.xhtml') {
            event.detail.data = bytes
            event.detail.type = 'text/html;charset=windows-1252'
        }
    })
    try {
        const url = await epub.sections[0].load()
        const response = await fetch(url)
        const resultBytes = new Uint8Array(await response.arrayBuffer())
        const contentType = response.headers.get('content-type')
        const document = await loadRendered(url)
        return { text: document.body.textContent, contentType,
            rawBytesUnchanged: resultBytes.length === bytes.length && resultBytes.every((b, i) => b === bytes[i]) }
    } finally { epub.sections.forEach(s => s.unload()) }
}
