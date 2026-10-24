import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createRequire } from 'node:module'
import { fixtures, resourcesFor } from './fixtures.mjs'
import { encodingFixtures } from './encoding-fixtures.mjs'
import AdmZip from 'adm-zip'
import { parseEpub, readEpubRanges } from '../src/node.js'
import { EPUB_EXTRACTOR_VERSION, NORMALIZATION_VERSION } from '../src/index.js'
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const root = new URL('../../../', import.meta.url)
const routes = new Map(await Promise.all([
    'packages/epub-core/src/decode.js', 'frontend/src/vendor/foliate-js/view.js',
    'frontend/src/vendor/foliate-js/progress.js', 'frontend/src/vendor/foliate-js/overlayer.js', 'frontend/src/vendor/foliate-js/text-walker.js', 'frontend/src/vendor/foliate-js/vendor/zip.js',
    'packages/epub-core/src/index.js', 'packages/epub-core/test/fixtures.mjs', 'packages/epub-core/test/host-case.mjs',
    'frontend/src/vendor/foliate-js/paginator.js', 'packages/epub-core/src/foliate/epub.js', 'packages/epub-core/src/foliate/epubcfi.js',
    'frontend/src/vendor/foliate-js/reader-range.js', 'frontend/src/vendor/foliate-js/section-view.js', 'frontend/src/vendor/foliate-js/continuous-scroll.js',
].map(async path => [`/${path}`, await readFile(new URL(path, root), 'utf8')])))
const server = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><script type="importmap">{"imports":{"@readeverywhere/epub-core/decode":"/packages/epub-core/src/decode.js","@readeverywhere/epub-core/":"/packages/epub-core/src/"}}</script></head><body></body></html>'); return }
    if (!routes.has(req.url)) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', 'text/javascript'); res.end(routes.get(req.url))
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
let browser
const report = { node: process.version, icu: process.versions.icu, jsdom: '26.1.0',
    foliateHashes: Object.fromEntries([...routes].filter(([p]) => p.includes('foliate')).map(([p, data]) => [p, createHash('sha256').update(data).digest('hex')])), cases: [], failures: [] }
function runNode(fixture) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./node-worker.mjs', import.meta.url), { workerData: fixture })
        const timer = setTimeout(() => { void worker.terminate(); reject(new Error(`Worker deadline: ${fixture.id}`)) }, 15000)
        worker.once('message', value => { clearTimeout(timer); void worker.terminate(); resolve(value) })
        worker.once('error', error => { clearTimeout(timer); reject(error) })
        worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Worker exited: ${code}`)) })
    })
}
try {
    browser = await chromium.launch({ headless: true })
    report.chromium = browser.version()
    const context = await browser.newContext()
    const base = `http://127.0.0.1:${server.address().port}`
    await context.route('**/*', route => {
        const url = route.request().url()
        return url.startsWith(base + '/') || url.startsWith('blob:') ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    await page.goto(base)
    report.structuredRanges = []
    for (const fixture of [
        { id: 'second-repeated-passage', body: '<p id="first">重复句子。</p><p id="second">重复句子。</p>', quote: '重复句子。', second: true },
        { id: 'cross-inline-nfc', body: '<p>e<span>\u0301</span>lan</p>', quote: 'e\u0301lan' },
        { id: 'pre-whitespace', body: '<pre> a\n b </pre>', quote: ' a\n b ' },
        { id: 'synthetic-range-edges', body: '<img alt="首合成"/><p>真实正文。</p><img alt="尾合成"/>', quote: '真实正文。', gaps: true },
    ]) {
        const source = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>强结构范围</title></head><body>${fixture.body}</body></html>`
        const zip = new AdmZip()
        for (const [name,value] of Object.entries(resourcesFor({ source,mediaType:'application/xhtml+xml' }))) zip.addFile(name,Buffer.from(value))
        const bytes=zip.toBuffer(),parsed=await parseEpub(bytes),text=parsed.sections[0].text
        const scope={bookId:1,fileChecksum:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,extractorVersion:EPUB_EXTRACTOR_VERSION,normalizationVersion:NORMALIZATION_VERSION}
        const start=fixture.second?text.lastIndexOf('重复句子。'):0
        const result=await readEpubRanges(bytes,scope,[{sectionIndex:0,href:'OPS/chapter.xhtml',start,end:text.length}])
        if(result.candidates.length!==1)throw Error(`Missing structural candidate: ${fixture.id}`)
        const candidate=result.candidates[0]
        const web=await page.evaluate(async ({bytes,candidate})=>{
            const {makeBook}=await import('/frontend/src/vendor/foliate-js/view.js')
            const book=await makeBook(new File([new Uint8Array(bytes)],'ranges.epub',{type:'application/epub+zip'}))
            const view=document.createElement('foliate-view');view.style.cssText='width:900px;height:700px';document.body.append(view)
            try {
                await view.open(book);await view.goTo(candidate.cfi)
                const resolved=view.resolveCFI(candidate.cfi),content=view.renderer.getContents().find(c=>c.index===resolved.index)
                if(!content)throw Error('Structural CFI did not navigate to its section')
                const range=resolved.anchor(content.doc)
                const element=range.startContainer.nodeType===3?range.startContainer.parentElement:range.startContainer
                return {quote:range.toString(),second:!!element.closest?.('#second'),sectionIndex:resolved.index}
            } finally {view.close();view.remove()}
        },{bytes:Array.from(bytes),candidate})
        const passed=web.quote===fixture.quote && web.quote===candidate.displayedQuote && web.sectionIndex===0 && (!fixture.second||web.second) && (!fixture.gaps||result.unavailable.length===2)
        report.structuredRanges.push({id:fixture.id,passed,web,candidate,gaps:result.unavailable})
        if(!passed)report.failures.push(`strong structural CFI: ${fixture.id}`)
        console.log(`${passed?'PASS':'FAIL'} strong structural CFI: ${fixture.id}`)
    }
    report.zipEncodingCases = []
    for (const fixture of encodingFixtures) {
        const zip = new AdmZip()
        const resources = resourcesFor({ source: '', mediaType: fixture.mediaType })
        resources['OPS/chapter.xhtml'] = fixture.bytes
        for (const [name, value] of Object.entries(resources)) zip.addFile(name, Buffer.from(value))
        const bytes = zip.toBuffer()
        let node
        try { node = { text: (await parseEpub(bytes)).sections[0].text } }
        catch (error) { node = { error: error.message } }
        const web = await page.evaluate(async bytes => {
            const { makeBook } = await import('/frontend/src/vendor/foliate-js/view.js')
            const core = await import('/packages/epub-core/src/index.js')
            const CFI = await import('/packages/epub-core/src/foliate/epubcfi.js')
            let book, frame
            try {
                book = await makeBook(new File([new Uint8Array(bytes)], 'encoding.epub', { type: 'application/epub+zip' }))
                const doc = await book.sections[0].createDocument()
                const map = core.buildSourceMap(doc)
                const url = await book.sections[0].load()
                frame = document.createElement('iframe')
                frame.setAttribute('sandbox', 'allow-same-origin')
                const loaded = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('ZIP iframe deadline')), 5000)
                    frame.onload = () => { clearTimeout(timeout); resolve() }
                })
                frame.src = url; document.body.append(frame); await loaded
                const rendered = frame.contentDocument
                const source = core.canonicalToSource(map, { start: 0, end: 4 })
                const range = core.rangeFromSource(rendered, source)
                const oldCFI = 'epubcfi(/4/2[p],/1:0,/1:4)'
                return { text: map.text, renderedText: core.buildSourceMap(rendered).text,
                    sourceQuote: range.toString(), cfi: CFI.fromRange(range), oldQuote: CFI.toRange(rendered, CFI.parse(oldCFI)).toString() }
            } catch (error) { return { error: error.message } }
            finally { if (frame) frame.remove(); if (book) book.sections.forEach(section => section.unload()) }
        }, Array.from(bytes))
        const passed = fixture.rejects ? Boolean(node.error && web.error && /encod|TextDecoder/iu.test(node.error) && /encod|TextDecoder/iu.test(web.error))
            : node.text === 'café' && web.text === 'café' && web.renderedText === 'café' && web.sourceQuote === 'café'
                && web.oldQuote === 'café' && web.cfi === 'epubcfi(/4/2[p],/1:0,/1:4)'
        report.zipEncodingCases.push({ id: fixture.id, node, web, passed })
        if (!passed) report.failures.push(`real ZIP decoding: ${fixture.id}`)
        console.log(`${passed ? 'PASS' : 'FAIL'} real ZIP decoding: ${fixture.id}`)
    }
    report.encodingCases = []
    for (const mode of ['decoded-source', 'raw-transform']) {
        const result = await page.evaluate(async mode => {
            const { runEncodingCase } = await import('/packages/epub-core/test/host-case.mjs')
            let frame
            try {
                return await runEncodingCase(mode, async url => {
                    frame = document.createElement('iframe')
                    frame.setAttribute('sandbox', 'allow-same-origin')
                    const loaded = new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('encoding frame deadline')), 5000)
                        frame.onload = () => { clearTimeout(timer); resolve() }
                    })
                    frame.src = url; document.body.append(frame); await loaded
                    return frame.contentDocument
                })
            } finally { if (frame) frame.remove() }
        }, mode)
        const passed = result.text === 'café' && (mode === 'raw-transform'
            ? result.rawBytesUnchanged && result.contentType === 'text/html;charset=windows-1252'
            : result.contentType === 'text/html;charset=utf-8')
        report.encodingCases.push({ mode, ...result, passed })
        if (!passed) report.failures.push(`encoding boundary: ${mode}`)
        console.log(`${passed ? 'PASS' : 'FAIL'} encoding boundary: ${mode}`)
    }
    const cases = [...fixtures, { ...fixtures[0], id: 'ncx-cross-resource', toc: 'ncx' }]
    for (const fixture of cases) {
        const node = await runNode(fixture)
        const chromiumResult = await page.evaluate(async fixture => {
            const { runCase } = await import('/packages/epub-core/test/host-case.mjs')
            await import('/frontend/src/vendor/foliate-js/paginator.js')
            const readers = []
            try {
                return await runCase(fixture, async url => {
                    const reader = document.createElement('foliate-paginator')
                    reader.style.cssText = 'display:block;width:800px;height:600px'
                    readers.push(reader)
                    document.body.append(reader)
                    reader.open({ dir: 'ltr', sections: [{ load: async () => url }] })
                    await reader.goTo({ index: 0 })
                    const [{ doc }] = reader.getContents()
                    if (doc.head && doc.head.querySelectorAll('style').length < 2)
                        throw new Error('Production paginator head styles were not injected')
                    return doc
                })
            } finally { readers.forEach(reader => { reader.destroy(); reader.remove() }) }

        }, fixture)
        const failures = []
        if (node.result.canonical.text !== fixture.expected || chromiumResult.canonical.text !== fixture.expected) failures.push('manual text gold')
        if (!isDeepStrictEqual(node.result.canonical, chromiumResult.canonical)) failures.push('Node/Chromium canonical tree/map')
        for (const [host, result] of [['node', node.result], ['chromium', chromiumResult]]) {
            if (result.renderError) failures.push(`${host} Foliate render: ${result.renderError.message}`)
            else if (!isDeepStrictEqual(result.canonical, result.rendered)) failures.push(`${host} canonical/rendered tree/map`)
            if (!isDeepStrictEqual(result.before, result.canonical)) failures.push(`${host} original createDocument/canonical`)
            if (!result.renderError && !isDeepStrictEqual(result.after, result.canonical)) failures.push(`${host} post-load createDocument/canonical`)
            if ((fixture.fallback || fixture.mediaType === 'text/html') && !result.renderError
                && !/charset=utf-8/i.test(result.contentType)) failures.push(`${host} HTML UTF-8 output declaration`)
            if (fixture.selection && !result.renderError) {
                const s = result.selection, gold = fixture.selection
                if (s.canonicalRange.start !== gold.canonicalStart || s.canonicalRange.end !== gold.canonicalEnd
                    || s.restoredQuote !== gold.quote || s.oldQuote !== gold.quote || s.cfi !== gold.oldCFI
                    || !isDeepStrictEqual(s.oldStart, result.canonical.segments.find(x => x.canonicalStart <= gold.canonicalStart && x.canonicalEnd > gold.canonicalStart).start.path)) failures.push(`${host} selection/old CFI gold`)
            }
            if (result.sections.length !== 3 || result.sections[1].id !== 'OPS/empty.xhtml' || result.sections[2].id !== 'OPS/second.xhtml') failures.push(`${host} physical spine`)
            if (result.toc.length !== 1 || result.toc[0].label !== '第一章' || result.toc[0].subitems[0].href !== 'OPS/second.xhtml') failures.push(`${host} TOC gold`)
        }
        report.cases.push({ id: fixture.id, node, chromium: chromiumResult, failures })
        report.failures.push(...failures.map(f => `${fixture.id}: ${f}`))
        console.log(`${failures.length ? 'FAIL' : 'PASS'} ${fixture.id}${failures.length ? ': ' + failures.join('; ') : ''}`)
    }
} finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
    await mkdir(new URL('../reports/', import.meta.url), { recursive: true })
    await writeFile(new URL('../reports/hosts.json', import.meta.url), JSON.stringify(report, null, 2))
}
if (report.failures.length) process.exitCode = 1
