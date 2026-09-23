import { parentPort, workerData } from 'node:worker_threads'
import { JSDOM } from 'jsdom'
const host = new JSDOM('')
// Isolated worker only. No globals are changed in the application/test runner.
for (const name of ['DOMParser', 'XMLSerializer', 'Node', 'NodeFilter', 'ProcessingInstruction', 'CustomEvent', 'EventTarget'])
    globalThis[name] = host.window[name]
const { runCase } = await import('./host-case.mjs')
try {
    const start = performance.now()
    const result = await runCase(workerData, async (_url, markup, mediaType) => new DOMParser().parseFromString(markup, mediaType))
    parentPort.postMessage({ result, durationMs: performance.now() - start, rss: process.memoryUsage().rss })
} finally { host.window.close() }
