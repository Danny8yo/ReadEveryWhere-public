// One byte-to-string contract for EPUB archive/directory resources on both hosts.
// BOM and XML byte signatures precede declarations. Invalid bytes/labels fail closed.
// References: XML 1.0 appendix F; HTML encoding prescan (first 1024 bytes).
const attributes = text => {
    const result = new Map()
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu
    for (const match of text.matchAll(pattern)) {
        const name = match[1].toLowerCase()
        if (!result.has(name)) result.set(name, match[2] ?? match[3] ?? match[4] ?? '')
    }
    return result
}
function declaredEncoding(prefix, mediaType) {
    if (mediaType === 'application/xml' || mediaType === 'text/xml' || mediaType.endsWith('+xml')) {
    const xml = prefix.match(/^<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/iu)
    return xml ? xml[1] : 'utf-8'
    }
    if (mediaType === 'text/css') {
    const css = prefix.match(/^@charset "([^"]+)";/u)
    return css ? css[1] : 'utf-8'
    }
    if (mediaType !== 'text/html') return 'utf-8'
    // This limited EPUB HTML prescan is not the complete browser sniff algorithm.
    // Tokenize tags to avoid charset-looking strings in comments or attributes.
    const tags = /<!--[\s\S]*?(?:-->|$)|<([a-z][a-z\d:-]*)(\s(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?\s*>/giu
    let match
    while ((match = tags.exec(prefix))) {
        if (!match[1]) continue
        const tag = match[1].toLowerCase()
        if (['script', 'style', 'title', 'textarea'].includes(tag)) {
            const closing = new RegExp(`</${tag}\\s*>`, 'giu')
            closing.lastIndex = tags.lastIndex
            const end = closing.exec(prefix)
            if (!end) break
            tags.lastIndex = closing.lastIndex
            continue
        }
        if (tag !== 'meta') continue
        const attrs = attributes(match[2] ?? '')
        let label = attrs.get('charset')
        if (label === undefined && attrs.get('http-equiv')?.toLowerCase() === 'content-type')
            label = attrs.get('content')?.match(/\bcharset\s*=\s*["']?([^\s;"']+)/iu)?.[1]
        if (label !== undefined) {
            const normalized = label.trim().toLowerCase()
            if (normalized === 'x-user-defined') return 'windows-1252'
            const encoding = new TextDecoder(normalized, { fatal: true }).encoding
            return encoding.startsWith('utf-16') ? 'utf-8' : encoding
        }
    }
    return 'utf-8'
}
export function decodeEpubText(bytes, mediaType) {
    if (typeof mediaType !== 'string' || !mediaType.trim()) throw new TypeError('EPUB text media type is required')
    mediaType = mediaType.split(';')[0].trim().toLowerCase()
    if (!(bytes instanceof Uint8Array)) throw new TypeError('EPUB text input must be Uint8Array')
    let encoding
    if ((bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
        || (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
        || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0x3c)
        || (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0))
        throw new Error('Unsupported EPUB text encoding: UTF-32')
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8'
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
    else if (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0x3f && bytes[3] === 0) encoding = 'utf-16le'
    else if (bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0 && bytes[3] === 0x3f) encoding = 'utf-16be'
    else encoding = declaredEncoding(Array.from(bytes.subarray(0, 1024), byte => String.fromCharCode(byte)).join(''), mediaType)
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
}
