// Shared chapter normalization and source-location contract.
export const EPUB_EXTRACTOR_VERSION = 'epub-extractor-v5'
export const NORMALIZATION_VERSION = 'epub-source-map-v2'
const XHTML = 'application/xhtml+xml'
const HTML = 'text/html'

export class LocationError extends Error {
    constructor(code, detail) { super(`${code}: ${detail}`); this.code = code }
}
const fail = (code, detail) => { throw new LocationError(code, detail) }

// XHTML fallback condition follows vendored Foliate (John Factotum, MIT); see LICENSE.foliate.
// The host provides a DOMParser; no DOM globals, script execution or I/O here.
export function parseChapter(source, mediaType, parser) {
    if (![XHTML, HTML].includes(mediaType)) fail('UNSUPPORTED_MEDIA_TYPE', mediaType)
    let document = parser.parseFromString(source, mediaType)
    let effectiveMediaType = mediaType
    if (mediaType === XHTML && (document.querySelector('parsererror')
        || !document.documentElement.namespaceURI)) {
        effectiveMediaType = HTML
        document = parser.parseFromString(source, HTML)
    }
    if (!document.body) fail('UNSUPPORTED_DOCUMENT', 'Chapter has no XHTML/HTML body')
    return { document, effectiveMediaType }
}

export function addressOf(node) {
    const address = []
    while (node.parentNode) {
        address.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node))
        node = node.parentNode
    }
    return address
}
export function nodeAt(document, address) {
    if (!Array.isArray(address)) fail('INVALID_SOURCE', 'Expected node address')
    let node = document
    for (const index of address) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= node.childNodes.length)
            fail('INVALID_SOURCE', `Node address ${address}`)
        node = node.childNodes[index]
    }
    return node
}

const blocks = new Set('p div section article aside header footer h1 h2 h3 h4 h5 h6 blockquote ul ol li table tr pre figure figcaption dl dt dd address caption main nav tbody td tfoot th thead'.split(' '))
const excluded = new Set('script style link noscript template'.split(' '))
const pointKey = point => `${point.path.join('.')}:${point.offset}`

// Each normalization run retains its source endpoints. There is deliberately
// no "find quote" fallback. Collapsed whitespace/NFC interiors are unrepresentable.
export function buildSourceMap(document) {
    const raw = []
    const sources = new Map()
    const emitSynthetic = (text, kind) => raw.push({ text, kind, start: null, end: null, preserve: true })
    function visit(node, preserve = false) {
        if (node.nodeType === 3 || node.nodeType === 4) {
            const path = addressOf(node)
            sources.set(path.join('.'), node.nodeValue)
            if (node.nodeValue) raw.push({ text: node.nodeValue, kind: 'text', preserve,
                start: { path, offset: 0 }, end: { path, offset: node.nodeValue.length } })
            return
        }
        if (node.nodeType !== 1) return
        const tag = node.localName.toLowerCase()
        if (excluded.has(tag)) return
        if (tag === 'img') {
            const alt = node.getAttribute('alt')
            if (alt && alt.trim()) emitSynthetic(`[Image: ${alt.trim().normalize('NFC')}]`, 'image-alt')
            return
        }
        if (tag === 'br') { emitSynthetic('\n', 'line-break'); return }
        if (blocks.has(tag) && raw.length && !raw.at(-1).text.endsWith('\n')) emitSynthetic('\n', 'block-separator')
        for (const child of node.childNodes) visit(child, preserve || tag === 'pre' || tag === 'code')
        if (blocks.has(tag) && raw.length && !raw.at(-1).text.endsWith('\n')) emitSynthetic('\n', 'block-separator')
    }
    visit(document.body)
    // NFC must span inline node boundaries, including combining characters in spans.
    const normalized = []
    const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
    const append = atom => {
        const previous = normalized.at(-1)
        if (atom.kind === 'text' && !atom.preserve && /^\s+$/u.test(atom.text)) {
            if (previous?.kind === 'collapsed-whitespace') { previous.end = atom.end; return }
            normalized.push({ ...atom, text: ' ', kind: 'collapsed-whitespace', linear: false })
        } else if (atom.linear && previous?.linear && previous.preserve === atom.preserve
            && previous.end.path === atom.start.path && previous.end.offset === atom.start.offset) {
            previous.text += atom.text
            previous.end = atom.end
        } else normalized.push(atom)
    }
    for (let i = 0; i < raw.length;) {
        if (raw[i].kind !== 'text') { append(raw[i++]); continue }
        let j = i
        const offsets = []
        let text = ''
        while (j < raw.length && raw[j].kind === 'text' && raw[j].preserve === raw[i].preserve) {
            offsets.push(text.length); text += raw[j++].text
        }
        let first = 0, last = 0
        for (const segment of segmenter.segment(text)) {
            const end = segment.index + segment.segment.length
            while (first + 1 < offsets.length && offsets[first + 1] <= segment.index) first++
            while (last + 1 < offsets.length && offsets[last + 1] < end) last++
            const value = segment.segment.normalize('NFC')
            append({ text: value, kind: 'text', preserve: raw[i].preserve,
                linear: value.length === 1 && value === segment.segment && first === last,
                start: { path: raw[i + first].start.path, offset: segment.index - offsets[first] },
                end: { path: raw[i + last].end.path, offset: end - offsets[last] } })
        }
        i = j
    }
    // Trim only ordinary boundary whitespace, never pre/code content.
    while (normalized.length && !normalized[0].preserve && /^\s+$/u.test(normalized[0].text)) normalized.shift()
    while (normalized.length && (normalized.at(-1).kind === 'block-separator'
        || (!normalized.at(-1).preserve && /^\s+$/u.test(normalized.at(-1).text)))) normalized.pop()
    const text = normalized.map(atom => atom.text).join('')
    const paths = [...sources.keys()].map(key => key.split('.').map(Number))
    const pathIds = new Map(paths.map((path, id) => [path.join('.'), id]))
    const data = new Uint32Array(normalized.length * 8)
    let offset = 0
    for (let i = 0; i < normalized.length; i++) {
        const atom = normalized[i], row = i * 8
        data[row] = offset
        offset += atom.text.length
        data[row + 1] = offset
        data[row + 2] = atom.start ? pathIds.get(atom.start.path.join('.')) + 1 : 0
        data[row + 3] = atom.start ? atom.start.offset : 0
        data[row + 4] = atom.end ? pathIds.get(atom.end.path.join('.')) + 1 : 0
        data[row + 5] = atom.end ? atom.end.offset : 0
        data[row + 6] = segmentKinds.indexOf(atom.kind)
        data[row + 7] = (atom.preserve ? 1 : 0) | (atom.linear ? 2 : 0)
        normalized[i] = null
    }
    const segments = new CompactSegments(text, paths, data)
    return { text, segments, sources }

}

const segmentKinds = ['text', 'collapsed-whitespace', 'block-separator', 'line-break', 'image-alt']
// Columnar source records: eight uint32 values per run, paths stored once per text node.
// Iteration materializes only the requested record; toJSON is for diagnostic host snapshots.
class CompactSegments {
    constructor(text, paths, data) { this.text = text; this.paths = paths; this.data = data }
    get length() { return this.data.length / 8 }
    at(index) {
        if (index < 0) index += this.length
        if (index < 0 || index >= this.length) return undefined
        const row = index * 8, d = this.data
        return { text: this.text.slice(d[row], d[row + 1]), canonicalStart: d[row], canonicalEnd: d[row + 1],
            start: d[row + 2] ? { path: this.paths[d[row + 2] - 1], offset: d[row + 3] } : null,
            end: d[row + 4] ? { path: this.paths[d[row + 4] - 1], offset: d[row + 5] } : null,
            kind: segmentKinds[d[row + 6]], preserve: Boolean(d[row + 7] & 1), linear: Boolean(d[row + 7] & 2) }
    }
    *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.at(i) }
    find(predicate) { for (const record of this) if (predicate(record)) return record }
    filter(predicate) { return Array.from(this).filter(predicate) }
    map(transform) { return Array.from(this, transform) }
    toJSON() { return Array.from(this) }
}

function validatePoint(map, point) {
    if (!point || !Array.isArray(point.path) || !point.path.every(n => Number.isSafeInteger(n) && n >= 0)
        || !Number.isSafeInteger(point.offset)) fail('INVALID_SOURCE', 'Malformed endpoint')
    const text = map.sources.get(point.path.join('.'))
    if (text === undefined || point.offset < 0 || point.offset > text.length) fail('INVALID_SOURCE', pointKey(point))
}
export function sourceToCanonical(map, source) {
    validatePoint(map, source.start); validatePoint(map, source.end)
    const locate = (point, side) => {
        const { data, paths } = map.segments
        const pathId = paths.findIndex(path => path.join('.') === point.path.join('.')) + 1
        const field = side === 'start' ? 2 : 4
        for (let row = 0; row < data.length; row += 8) {
            if (data[row + field] !== pathId) continue
            if (data[row + field + 1] === point.offset) return data[row + (side === 'start' ? 0 : 1)]
            if ((data[row + 7] & 2) && point.offset > data[row + 3] && point.offset < data[row + 5])
                return data[row] + point.offset - data[row + 3]
        }
    }
    const start = locate(source.start, 'start')
    const end = locate(source.end, 'end')
    if (start === undefined || end === undefined || start >= end)
        fail('UNREPRESENTABLE_RANGE', 'Endpoint is trimmed, synthetic, inside NFC/whitespace, or reversed')
    return { start, end, quote: map.text.slice(start, end) }
}
export function canonicalToSource(map, range) {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0
        || range.end > map.text.length || range.start >= range.end) fail('INVALID_RANGE', 'Expected nonempty UTF-16 range')
    const locate = (offset, side) => {
        const { data } = map.segments
        let low = 0, high = map.segments.length - 1
        while (low <= high) {
            const mid = (low + high) >>> 1, row = mid * 8
            const boundary = data[row + side]
            if (boundary === offset) return map.segments.at(mid)
            if (offset > data[row] && offset < data[row + 1])
                return data[row + 7] & 2 ? map.segments.at(mid) : undefined
            if (boundary < offset) low = mid + 1
            else high = mid - 1
        }
    }
    const first = locate(range.start, 0)
    const last = locate(range.end, 1)
    if (!first || !last || !first.start || !last.end) fail('UNREPRESENTABLE_RANGE', 'Synthetic or normalized interior endpoint')
    return { start: { path: first.start.path, offset: first.start.offset + range.start - first.canonicalStart },
        end: { path: last.end.path, offset: last.end.offset - (last.canonicalEnd - range.end) } }
}
export function rangeFromSource(document, source) {
    const range = document.createRange()
    range.setStart(nodeAt(document, source.start.path), source.start.offset)
    range.setEnd(nodeAt(document, source.end.path), source.end.offset)
    return range
}

const scopeFields = ['bookId', 'fileChecksum', 'extractorVersion', 'normalizationVersion', 'sectionIndex', 'href']
function validateScope(scope) {
    if (!scope || !Number.isSafeInteger(scope.bookId) || scope.bookId <= 0
        || !Number.isSafeInteger(scope.sectionIndex) || scope.sectionIndex < 0
        || scopeFields.slice(1).filter(k => k !== 'sectionIndex').some(k => typeof scope[k] !== 'string' || !scope[k]))
        fail('INVALID_SCOPE', 'Missing book, revision or resource identity')
    if (scope.normalizationVersion !== NORMALIZATION_VERSION) fail('VERSION_MISMATCH', scope.normalizationVersion)
}
export function resolveSelection(document, map, expectedScope, request) {
    validateScope(expectedScope); validateScope(request.scope)
    for (const key of scopeFields) if (expectedScope[key] !== request.scope[key]) fail('SCOPE_MISMATCH', key)
    const canonical = sourceToCanonical(map, request.source)
    const displayedQuote = rangeFromSource(document, request.source).toString()
    if (!displayedQuote || displayedQuote !== request.displayedQuote) fail('QUOTE_MISMATCH', 'Source quote differs')
    // Require exact endpoint round trip; never expand a selection to fit an atom.
    const restored = canonicalToSource(map, canonical)
    if (pointKey(restored.start) !== pointKey(request.source.start) || pointKey(restored.end) !== pointKey(request.source.end))
        fail('UNREPRESENTABLE_RANGE', 'Source endpoints do not round trip')
    return { scope: { ...expectedScope }, source: restored, displayedQuote, canonicalQuote: canonical.quote,
        start: canonical.start, end: canonical.end }
}

// Empty anchors use the next source-backed canonical boundary in DOM order.
// No text search or DOM mutation is involved.
export function canonicalOffsetAtElement(map, element) {
    const address = addressOf(element)
    for (const segment of map.segments) {
        if (!segment.start) continue
        const path = segment.start.path
        let order = 0
        for (let i = 0; i < Math.min(path.length, address.length); i++) {
            if (path[i] !== address[i]) { order = path[i] - address[i]; break }
        }
        if (order >= 0) return segment.canonicalStart
    }
    return map.text.length
}
