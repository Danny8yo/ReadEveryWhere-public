// UI-only baseline with self-authored EPUB and explicit HTTP mocks; no backend/database.
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
const frontend = new URL('../../../frontend/', import.meta.url)
const require = createRequire(new URL('package.json', frontend))
const { chromium, expect, devices } = require('@playwright/test')
const { preview } = await import(pathToFileURL(require.resolve('vite')).href)
const epub = await readFile(new URL('e2e/fixtures/interaction.epub', frontend))
const output = new URL('../reports/ui-baseline/', import.meta.url)
await mkdir(output, { recursive: true })
const server = await preview({ root: fileURLToPath(frontend), preview: { host: '127.0.0.1', port: 5199, strictPort: true } })
let browser
const book = { id: 7, userId: 1, title: '定位验收书', authors: ['测试作者'], authorsText: '测试作者', isbn: null, language: 'zh', coverUrl: null, description: null, publisher: null, sourcePlatform: 'manual', sourceBookId: null, sourceUrl: null, publishYear: null, editionTag: null, version: 1, createdAt: '2026-09-10', updatedAt: '2026-09-10', fileName: 'interaction.epub', fileSize: epub.length, isDownloaded: true, fileUrl: '/api/v1/library/books/7/file', checksum: 'fixture', mimeType: 'application/epub+zip', format: 'epub', downloadStatus: 'completed', doubanRating: null }
try {
    browser = await chromium.launch()
    for (const [name, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['mobile', devices['Pixel 7']]]) {
        const context = await browser.newContext(options)
        const page = await context.newPage()
        await page.addInitScript(() => {
            const originalFetch = window.fetch.bind(window)
            window.fetch = (input, init) => String(input).includes('/reading-state/stream')
                ? Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': connected\n\n')) } }), { headers: { 'Content-Type': 'text/event-stream' } })) : originalFetch(input, init)
            localStorage.setItem('readEveryWhere.backendBaseUrl', '127.0.0.1:5199')
            localStorage.setItem('readEveryWhere.accessToken', 'mock-token')
            localStorage.setItem('readEveryWhere.refreshToken', 'mock-refresh')
            localStorage.setItem('readEveryWhere.user', JSON.stringify({ userId: 1, email: 'fixture@example.test' }))
        })
        const unexpected = []
        await page.route('**/*', async route => {
            const url = new URL(route.request().url())
            if (url.origin !== 'http://127.0.0.1:5199') return route.abort()
            if (!url.pathname.startsWith('/api/')) return route.continue()
            const path = url.pathname
            const ok = data => route.fulfill({ json: { code: 0, message: 'ok', data } })
            if (path === '/api/v1/library/books') return ok({ items: [book], total: 1, page: 1, pageSize: 20 })
            if (path === '/api/v1/library/books/7') return ok(book)
            if (path.endsWith('/file-access')) return ok({ url: '/api/v1/library/books/7/file', expiresAt: '2099-01-01' })
            if (path === '/api/v1/library/books/7/file') return route.fulfill({ contentType: 'application/epub+zip', body: epub })
            if (path === '/api/v1/reading-state') return ok({ revision: 1, progress: null, bookmarks: [], annotations: [] })
            if (path === '/api/v1/progress') return ok({ id: 1, ...route.request().postDataJSON(), revision: 1 })
            if (path === '/api/v1/book-analysis/books/7') return ok({ bookId: 7, status: 'not_analyzed', stale: false, candidate: null, errorCode: null })
            if (path === '/api/v1/ai-reading/model-config') return ok({ modelId: 'deepseek-v4-flash', configured: false })
            unexpected.push(`${route.request().method()} ${path}`)
            return route.fulfill({ status: 500, json: { code: 500, message: `Unmocked fixture request: ${path}` } })
        })
        await page.goto('http://127.0.0.1:5199')
        await expect(page.getByText(book.title, { exact: true }).first()).toBeVisible()
        await page.screenshot({ path: fileURLToPath(new URL(`${name}-library.png`, output)), animations: 'disabled' })
        await page.getByText(book.title, { exact: true }).first().click()
        await page.getByRole('button', { name: '开始阅读' }).click()
        await expect(page.locator('.book-reader foliate-view')).toBeAttached()
        await expect(page.locator('.book-reader .rd-spinner')).toHaveCount(0)
        await expect.poll(() => page.frames().filter(f => f.url().startsWith('blob:')).length).toBeGreaterThan(0)
        const content = page.frames().find(f => f.url().startsWith('blob:'))
        await expect(content.locator('#selection-text')).toBeVisible()
        await page.screenshot({ path: fileURLToPath(new URL(`${name}-reader.png`, output)), animations: 'disabled' })
        await content.locator('#selection-text').dblclick({ position: { x: 30, y: 10 } })
        await expect(page.getByRole('button', { name: '高亮', exact: true })).toBeVisible()
        await page.screenshot({ path: fileURLToPath(new URL(`${name}-toolbar.png`, output)), animations: 'disabled' })
        if (unexpected.length) throw new Error(`Unexpected requests: ${unexpected.join(', ')}`)
        console.log(`${name}: library / reader / toolbar captured (mock)`)
        await context.close()
    }
} finally { if (browser) await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)) }
