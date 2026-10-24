import test from 'node:test'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { openEpubArchive, safeArchivePath } from '../src/node-zip.js'
import { parseEpub, readEpubRanges, replayEpubRanges } from '../src/node.js'
import { resourcesFor, fixtures } from './fixtures.mjs'
const archive = resources => { const zip = new AdmZip(); for (const [name,text] of Object.entries(resources)) zip.addFile(name,Buffer.from(text)); return zip.toBuffer() }
test('structured ranges retain real text next to unmappable image boundaries and replay exactly', async () => {
    const { createHash } = await import('node:crypto')
    const { NORMALIZATION_VERSION, EPUB_EXTRACTOR_VERSION } = await import('../src/index.js')
    const fixture = { source:'<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><img alt="封面"/><p>真实正文。</p><img alt="末图"/></body></html>', mediaType:'application/xhtml+xml' }
    const bytes = archive(resourcesFor(fixture))
    const document = await parseEpub(bytes)
    const scope = { bookId:1,fileChecksum:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,extractorVersion:EPUB_EXTRACTOR_VERSION,normalizationVersion:NORMALIZATION_VERSION }
    const input = { sectionIndex:0,href:'OPS/chapter.xhtml',start:0,end:document.sections[0].text.length }
    const result = await readEpubRanges(bytes,scope,[input])
    assert.equal(result.candidates.length,1)
    assert.equal(result.candidates[0].quote,'真实正文。')
    assert.equal(result.unavailable.length,2)
    assert.equal(result.candidates[0].quote.length + result.unavailable.reduce((n,g)=>n+g.end-g.start,0),input.end)
    const replay = await replayEpubRanges(bytes,scope,result.candidates)
    assert.equal(replay[0].cfi,result.candidates[0].cfi)
    assert.equal(replay[0].displayedQuote,'真实正文。')
    const invalid = {...input,href:'forged.xhtml'}
    await assert.rejects(readEpubRanges(bytes,scope,[invalid]),/SCOPE_MISMATCH/)
})
test('archive paths reject traversal and external resources', () => {
    for (const path of ['../a', '/a', 'a/../b', 'https://example.org/a', 'a\\b', 'a\0b']) assert.throws(()=>safeArchivePath(path), /Unsafe/)
})
test('ZIP adapter decodes declared text without performing I/O', () => {
    const zip = new AdmZip(); zip.addFile('latin.html', Buffer.from('<meta charset="windows-1252"><p>caf\xe9</p>','latin1'))
    assert.match(openEpubArchive(zip.toBuffer()).text('latin.html', 'text/html'), /café/)
})
test('worker requires typed bytes and terminates on deadline', async () => {
    assert.throws(()=>parseEpub({}), /Uint8Array/)
    await assert.rejects(parseEpub(archive(resourcesFor(fixtures[0])), {timeoutMs:1}), /exceeded/)
})
test('worker preserves physical empty spine and does not install globals', async () => {
    const before = globalThis.DOMParser
    const result = await parseEpub(archive(resourcesFor(fixtures[0])))
    assert.equal(result.sections.length,3)
    assert.equal(result.sections[1].sectionIndex,1)
    assert.equal(result.sections[1].text,'')
    assert.equal(globalThis.DOMParser,before)
})
test('worker rejects missing resources and malformed XML', async () => {
    const resources = resourcesFor(fixtures[0]); delete resources['OPS/chapter.xhtml']
    await assert.rejects(parseEpub(archive(resources)), /Missing EPUB spine resource/)
    await assert.rejects(parseEpub(archive({'META-INF/container.xml':'<broken'})), /Invalid EPUB XML/)
})

test('Node selection verifies current bytes and exact second repeated source endpoints', async () => {
    const { createHash } = await import('node:crypto')
    const { JSDOM } = await import('jsdom')
    const { parseChapter, addressOf, NORMALIZATION_VERSION, EPUB_EXTRACTOR_VERSION } = await import('../src/index.js')
    const { resolveEpubSelection } = await import('../src/node.js')
    const bytes = archive(resourcesFor(fixtures[0]))
    const host = new JSDOM('')
    try {
        const document = parseChapter(fixtures[0].source, fixtures[0].mediaType, new host.window.DOMParser()).document
        const path = addressOf(document.querySelector('#second').firstChild)
        const scope = { bookId: 1, fileChecksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, extractorVersion: EPUB_EXTRACTOR_VERSION, normalizationVersion: NORMALIZATION_VERSION, sectionIndex: 0, href: 'OPS/chapter.xhtml' }
        const request = { scope, source: { start: {path,offset:0}, end:{path,offset:5} }, displayedQuote:'重复句子。' }
        const result = await resolveEpubSelection(bytes,scope,request)
        assert.equal(result.start,6); assert.equal(result.end,11)
        const byCFI = await resolveEpubSelection(bytes, scope, { scope, cfi: 'epubcfi(/6/2!/4/4[second],/1:0,/1:5)', displayedQuote: request.displayedQuote })
        assert.deepEqual(byCFI, result)
        await assert.rejects(resolveEpubSelection(bytes, {...scope,extractorVersion:'old'}, {...request,scope:{...scope,extractorVersion:'old'}}), /VERSION_MISMATCH/)
        await assert.rejects(resolveEpubSelection(bytes,{...scope,fileChecksum:'old'},request), /VERSION_MISMATCH/)
        await assert.rejects(resolveEpubSelection(bytes,scope,{...request,displayedQuote:'伪造'}), /QUOTE_MISMATCH/)
        await assert.rejects(resolveEpubSelection(bytes,scope,{...request,scope:{...scope,sectionIndex:2}}), /SCOPE_MISMATCH/)
    } finally { host.window.close() }
})
test('queued cancellation rejects promptly and next extraction remains usable', async () => {
    const bytes = archive(resourcesFor(fixtures[0]))
    const first = parseEpub(bytes)
    const controller = new AbortController()
    const queued = parseEpub(bytes,{signal:controller.signal})
    controller.abort(new Error('queued cancelled'))
    await assert.rejects(queued,/queued cancelled/)
    await first
    assert.equal((await parseEpub(bytes)).sections.length,3)
})

test('local context avoids decoding unrelated chapters while full extraction still validates them', async () => {
    const { createHash } = await import('node:crypto')
    const { readEpubContext } = await import('../src/node.js')
    const { EPUB_EXTRACTOR_VERSION, NORMALIZATION_VERSION } = await import('../src/index.js')
    const resources = resourcesFor(fixtures[0])
    const other = Object.keys(resources).find(path => path.endsWith('.xhtml') && path !== 'OPS/chapter.xhtml')
    assert.ok(other)
    resources[other] = Buffer.from([0xff, 0xfe, 0x01])
    const bytes = archive(resources)
    const scope = { bookId: 1, fileChecksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, extractorVersion: EPUB_EXTRACTOR_VERSION, normalizationVersion: NORMALIZATION_VERSION }
    const result = await readEpubContext(bytes, scope, { sectionIndex: 0, href: 'OPS/chapter.xhtml', start: 6, end: 11 }, 20)
    assert.ok(result[0].quote.includes('重复句子。'))
    await assert.rejects(parseEpub(bytes))
    await assert.rejects(readEpubContext(bytes, scope, { sectionIndex: 0, href: 'OPS/chapter.xhtml', start: 0, end: 100000 }, 100000), error => error.code === 'RANGE_OUT_OF_BOUNDS')
})
