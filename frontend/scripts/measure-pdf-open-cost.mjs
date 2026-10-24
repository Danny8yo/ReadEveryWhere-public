// 度量 pdf.js 打开一本 PDF 需要读取多少字节。
//
// 为什么需要它：前端把签名 URL 直接交给 pdf.js，由 pdf.js 发 Range 请求按需取块
// （见 vendor/foliate-js/pdf.js 的 makePDF）。但 pdf.js 在 getDocument() 返回之前会走
// checkLastPage → Catalog.getPageDict(numPages-1)，对「扁平页树」的 PDF 必须逐个
// fetch 每一个页对象；页对象若散落全书，open 阶段就会把整本书拉下来，分块传输完全
// 失效。决定打开速度的是页字典在文件里的物理分布，只能靠入库时重写 PDF 来改善。
//
// 本脚本就是那个改善的验收闸门：它用仓库自带的 pdf.js、makePDF 的同款参数、以及一个
// 真实支持 Range 的本地 HTTP server，量出 open 阶段的实际读取量。
//
// 用法：
//   node scripts/measure-pdf-open-cost.mjs <a.pdf> [b.pdf ...]
//
// 验收线：open 阶段读取 < 3MB，且与文件大小无关。

import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

// vendored 的 pdf.mjs 是浏览器构建，Node 里缺这些全局对象/新方法。都只在渲染路径上
// 用到，量字节数用不着真实实现，给最小垫片即可。
globalThis.DOMMatrix ??= class DOMMatrix {}
globalThis.Path2D ??= class Path2D {}
globalThis.ImageData ??= class ImageData {}
if (!Uint8Array.prototype.toHex) {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
        value() {
            return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('hex')
        },
    })
}
for (const Ctor of [Map, WeakMap]) {
    if (!Ctor.prototype.getOrInsertComputed) {
        Object.defineProperty(Ctor.prototype, 'getOrInsertComputed', {
            value(key, callback) {
                if (!this.has(key)) this.set(key, callback(key))
                return this.get(key)
            },
        })
    }
    if (!Ctor.prototype.getOrInsert) {
        Object.defineProperty(Ctor.prototype, 'getOrInsert', {
            value(key, value) {
                if (!this.has(key)) this.set(key, value)
                return this.get(key)
            },
        })
    }
}

await import('../src/vendor/foliate-js/vendor/pdfjs/pdf.mjs')
const pdfjsLib = globalThis.pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc =
    fileURLToPath(new URL('../public/pdfjs/pdf.worker.mjs', import.meta.url))

// 与 vendor/foliate-js/pdf.js 的 makePDF 保持一致，否则量出来的不是线上行为。
const RANGE_CHUNK_SIZE = 256 * 1024

const files = process.argv.slice(2)
if (!files.length) {
    console.error('用法: node scripts/measure-pdf-open-cost.mjs <a.pdf> [b.pdf ...]')
    process.exit(1)
}

const stats = { path: null, bytes: 0, rangeRequests: 0, fullRequests: 0 }

const server = createServer((req, res) => {
    const size = statSync(stats.path).size
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/pdf' }
    // pdf.js 先发一个无 Range 的 GET 探测服务端能力，收到响应头确认支持 Range 后立刻
    // abort。所以这里按「实际写出去的字节」计数，而不是按 Content-Length，否则每本书都
    // 会凭空多算一整个文件。
    const start = match ? Number(match[1]) : 0
    const end = match ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1
    if (start > end || start >= size) {
        // 上一本书销毁后可能还有在途的 Range 请求打进来，按 RFC 回 416，不要让
        // createReadStream 抛出把整个度量进程带崩。
        res.writeHead(416, { 'Content-Range': `bytes */${size}` })
        res.end()
        return
    }
    if (match) {
        stats.rangeRequests++
        res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': end - start + 1,
        })
    } else {
        stats.fullRequests++
        res.writeHead(200, { ...headers, 'Content-Length': size })
    }
    const file = createReadStream(stats.path, { start, end })
    file.on('data', chunk => { stats.bytes += chunk.length })
    file.on('error', () => res.destroy())
    res.on('close', () => file.destroy())
    file.pipe(res)
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

const mb = bytes => `${(bytes / 1048576).toFixed(2)} MB`

for (const path of files) {
    stats.path = path
    stats.bytes = 0
    stats.rangeRequests = 0
    stats.fullRequests = 0
    const size = statSync(path).size
    const startedAt = Date.now()
    try {
        const pdf = await pdfjsLib.getDocument({
            url: `http://127.0.0.1:${port}/book.pdf`,
            disableStream: true,
            disableAutoFetch: true,
            rangeChunkSize: RANGE_CHUNK_SIZE,
            isEvalSupported: false,
        }).promise
        const open = { bytes: stats.bytes, requests: stats.rangeRequests }
        // 首屏：foliate 的 section.load() 会 getPage(1) 后 render，这里用 operator list
        // 代替真正的画布渲染，取的是同一批网络读取。
        await (await pdf.getPage(1)).getOperatorList()
        const firstPage = { bytes: stats.bytes, requests: stats.rangeRequests }
        console.log(
            `${basename(path).slice(0, 28).padEnd(28)} | 文件 ${mb(size).padStart(9)} | ${String(pdf.numPages).padStart(4)} 页`
            + ` | open ${mb(open.bytes).padStart(9)} / ${String(open.requests).padStart(4)} range`
            + ` | +首页 ${mb(firstPage.bytes - open.bytes).padStart(9)} / ${firstPage.requests - open.requests} range`
            + ` | ${Date.now() - startedAt} ms`
            + ` | open 占全书 ${((open.bytes / size) * 100).toFixed(1)}%`,
        )
        await pdf.destroy()
    } catch (error) {
        console.log(`${basename(path).slice(0, 28).padEnd(28)} | 失败: ${error.message}`)
    }
}

server.close()
