import AdmZip from 'adm-zip'
import { decodeEpubText } from './decode.js'

export const ZIP_LIMITS = Object.freeze({ entries: 5000, entryBytes: 50 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 })

// No filesystem extraction, networking, or forgiving path rewrites.
export function safeArchivePath(path) {
    if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0')
        || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(path)
        || path.split('/').some(part => part === '..' || part === '.'))
        throw new Error(`Unsafe EPUB archive path: ${path}`)
    return path
}
export function openEpubArchive(bytes) {
    const zip = new AdmZip(Buffer.from(bytes))
    const entries = zip.getEntries()
    if (entries.length > ZIP_LIMITS.entries) throw new Error('EPUB has too many ZIP entries')
    let total = 0
    const files = new Map()
    for (const entry of entries) {
        const name = safeArchivePath(entry.entryName)
        const size = entry.header.size
        if (!Number.isSafeInteger(size) || size < 0 || size > ZIP_LIMITS.entryBytes)
            throw new Error(`EPUB ZIP entry exceeds limit: ${name}`)
        total += size
        if (total > ZIP_LIMITS.totalBytes) throw new Error('EPUB ZIP exceeds expanded size limit')
        if (files.has(name)) throw new Error(`Duplicate EPUB ZIP entry: ${name}`)
        files.set(name, entry)
    }
    const read = path => {
        const entry = files.get(safeArchivePath(path))
        if (!entry) return null
        if (entry.isDirectory) throw new Error(`EPUB resource is a directory: ${path}`)
        const data = entry.getData()
        if (data.length !== entry.header.size || data.length > ZIP_LIMITS.entryBytes)
            throw new Error(`EPUB ZIP size mismatch: ${path}`)
        return data
    }
    return {
        read,
        has: path => files.has(safeArchivePath(path)),
        size: path => { const entry = files.get(safeArchivePath(path)); return entry ? entry.header.size : 0 },
        text: (path, mediaType = 'application/xml') => {
            const data = read(path)
            if (data === null) return null
            return decodeEpubText(data, mediaType)
        },
    }
}
