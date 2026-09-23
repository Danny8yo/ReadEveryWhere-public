import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { writeFile, mkdir } from 'node:fs/promises'
if (!isMainThread) {
    const { JSDOM } = await import('jsdom')
    const core = await import('../src/index.js')
    const host = new JSDOM('')
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Large</title></head><body><p>' + '中文 e\u0301 😀 '.repeat(workerData.repetitions) + '</p></body></html>'
    const rssBefore = process.memoryUsage().rss
    const started = performance.now()
    const { document } = core.parseChapter(source, 'application/xhtml+xml', new host.window.DOMParser())
    const parsed = performance.now()
    const map = core.buildSourceMap(document)
    const mapped = performance.now()
    const first = map.segments.at(0), last = map.segments.at(-1)
    const selection = core.sourceToCanonical(map, { start: first.start, end: last.end })
    const back = core.canonicalToSource(map, selection)
    if (back.start.offset !== first.start.offset || back.end.offset !== last.end.offset) throw new Error('Large range round trip failed')
    const roundTripMs = performance.now() - mapped
    const cloneStarted = performance.now()
    const clonedRecords = structuredClone(map.segments.data)
    const cloneMs = performance.now() - cloneStarted
    if (clonedRecords.length !== map.segments.data.length) throw new Error('Packed record clone failed')
    parentPort.postMessage({ packedRecordBytes: map.segments.data.byteLength, cloneMs, inputUtf16: source.length, canonicalUtf16: map.text.length, segments: map.segments.length,
        parseMs: parsed - started, mapMs: mapped - parsed, roundTripMs,
        rssBefore, rssAfter: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed })
    host.window.close()
} else {
    let previous = performance.now(), maxMainThreadDelayMs = 0
    const heartbeat = setInterval(() => { const now = performance.now(); maxMainThreadDelayMs = Math.max(maxMainThreadDelayMs, now - previous - 10); previous = now }, 10)
    const measurements = []
    try {
    for (const repetitions of [25, 25000]) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { repetitions } })
    const deadline = setTimeout(() => { void worker.terminate() }, 15000)
    try {
        const metrics = await new Promise((resolve, reject) => {
            worker.once('message', resolve); worker.once('error', reject)
            worker.once('exit', code => { if (code) reject(new Error(`Benchmark terminated: ${code}`)) })
        })
        measurements.push({ repetitions, ...metrics })
    } finally { clearTimeout(deadline); await worker.terminate() }
    }
    } finally { clearInterval(heartbeat) }
    const report = { node: process.version, icu: process.versions.icu, measurements, maxMainThreadDelayMs,
        note: 'Self-authored small/large chapters; RSS includes runner and worker. Clone measures packed records only; production worker returns text/anchors, not source maps. Not a capacity guarantee.' }
    await mkdir(new URL('../reports/', import.meta.url), { recursive: true })
    await writeFile(new URL('../reports/benchmark.json', import.meta.url), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
}
