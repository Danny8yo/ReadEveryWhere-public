import { SectionView } from './section-view.js'
import { getVisibleRange, uncollapse } from './reader-range.js'

// Owns only the scroll window. Each section keeps its own document and overlayer.
// Native scrolling is never replaced with a wheel/touch chapter-switch gesture.
export class ContinuousScroll {
    #views = new Map()
    #generation = 0
    #disposed = false
    #busy = false
    #layout
    #vertical = false
    #primary = -1
    #snapshot
    #frame = 0
    #error = null
    #status = document.createElement('button')
    #abort = new AbortController()
    constructor({ host, container, sections, layout, styles, relocate }) {
        Object.assign(this, { host, container, sections, layout, styles, relocate })
        container.style.display = 'flex'
        container.style.flexDirection = 'column'
        container.style.overflowAnchor = 'none'
        this.#status.type = 'button'
        this.#status.style.cssText = 'flex:none;min-height:44px;border:0;background:transparent;color:inherit;cursor:pointer'
        this.#status.hidden = true
        this.#status.addEventListener('click', () => {
            this.#error = null
            void this.fill()
        }, { signal: this.#abort.signal })
        container.addEventListener('scroll', () => {
            if (this.#disposed) return
            if (!this.#frame) this.#frame = requestAnimationFrame(() => {
                this.#frame = 0
                if (this.#disposed || !this.#views.size) return
                this.report('scroll')
                void this.fill()
            })
        }, { signal: this.#abort.signal })
    }
    get entries() { return [...this.#views.entries()].filter(([, view]) => view.loaded).sort(([a], [b]) => a - b) }
    get index() { return this.#primary }
    get side() { return this.#vertical ? 'width' : 'height' }
    get size() { return this.container.getBoundingClientRect()[this.side] }
    get position() { return Math.abs(this.container[this.#vertical ? 'scrollLeft' : 'scrollTop']) }
    set position(value) { this.container[this.#vertical ? 'scrollLeft' : 'scrollTop'] = this.#vertical ? -value : value }
    get limit() {
        // Tiny chapters must still fill a screen; normal chapters keep the smaller window.
        const average = this.total / Math.max(1, this.entries.length)
        return Math.min(64, Math.max(16, Math.ceil(this.size * 1.5 / Math.max(1, average))))
    }
    get total() { return this.entries.reduce((sum, [, view]) => sum + view.element.getBoundingClientRect()[this.side], 0) }
    adjacent(index, dir) {
        for (let i = index + dir; i >= 0 && i < this.sections.length; i += dir)
            if (this.sections[i].linear !== 'no') return i
        return null
    }
    offset(index) {
        let value = 0
        for (const [i, view] of this.entries) {
            if (i === index) return value
            value += view.element.getBoundingClientRect()[this.side]
        }
        throw new Error(`Scroll section ${index} is not mounted`)
    }
    mapper(view) {
        const margin = this.#layout.margin
        return this.#vertical
            ? ({ left, right }) => ({ left: view.element.getBoundingClientRect().width - right - margin,
                right: view.element.getBoundingClientRect().width - left - margin })
            : ({ top, bottom }) => ({ left: top + margin, right: bottom + margin })
    }
    visible() {
        const entries = this.entries
        if (!entries.length) return null
        const pos = this.position
        let offset = 0
        for (const [index, view] of entries) {
            const length = view.element.getBoundingClientRect()[this.side]
            if (pos + Math.min(this.#layout.margin, this.size * 0.1) < offset + length - 1 || index === entries.at(-1)[0]) {
                const range = getVisibleRange(view.document, Math.max(0, pos - offset),
                    Math.min(length, pos - offset + this.size), this.mapper(view))
                return { index, view, range, fraction: Math.max(0, Math.min(1, (pos - offset) / length)) }
            }
            offset += length
        }
    }
    capture() {
        const current = this.visible()
        if (!current?.range) return
        const rect = current.range.getBoundingClientRect()
        this.#snapshot = { index: current.index, range: current.range.cloneRange(),
            offset: this.offset(current.index) + this.mapper(current.view)(rect).left - this.position }
    }
    restore() {
        const snapshot = this.#snapshot
        if (!snapshot) return
        const view = this.#views.get(snapshot.index)
        if (!view || !snapshot.range.startContainer.isConnected) return
        this.position = this.offset(snapshot.index)
            + this.mapper(view)(snapshot.range.getBoundingClientRect()).left - snapshot.offset
    }
    report(reason) {
        const current = this.visible()
        if (!current?.range) return
        this.#primary = current.index
        this.relocate({ reason, range: current.range, index: current.index, fraction: current.fraction })
        this.capture()
    }
    #drop(index) {
        const view = this.#views.get(index)
        this.host.dispatchEvent(new CustomEvent('unload', { detail: { index, doc: view.document } }))
        view.destroy()
        view.element.remove()
        this.#views.delete(index)
        this.sections[index].unload?.()
    }
    async #load(index, generation) {
        if (this.#views.has(index)) return
        const src = await this.sections[index].load()
        if (this.#disposed || generation !== this.#generation) {
            // A newer navigation may own the same section resource.
            if (!this.#views.has(index)) this.sections[index].unload?.()
            return
        }
        const view = new SectionView({ container: this.host,
            onExpand: () => { if (!this.#busy && !this.#disposed) this.restore() } })
        view.loaded = false
        view.element.style.position = 'absolute'
        view.element.style.visibility = 'hidden'
        this.#views.set(index, view)
        const next = this.entries.find(([i]) => i > index)?.[1]
        this.container.insertBefore(view.element, next ? next.element : this.#status.parentNode ? this.#status : null)
        await view.load(src, doc => {
            this.host.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
            this.styles(doc)
        }, direction => {
            if (!this.#layout) {
                this.#vertical = direction.vertical
                this.#layout = this.layout(direction)
                this.container.style.flexDirection = this.#vertical ? 'row' : 'column'
            } else if (direction.vertical !== this.#vertical) {
                throw new Error(`第 ${index + 1} 节文字方向不同，暂不能连续拼接，请用目录打开该节`)
            }
            return this.#layout
        })
        if (this.#disposed || generation !== this.#generation) return
        view.loaded = true
        view.element.style.position = 'relative'
        view.element.style.visibility = ''
        this.restore()
        this.host.dispatchEvent(new CustomEvent('create-overlayer', {
            detail: { doc: view.document, index, attach: overlayer => view.overlayer = overlayer },
        }))
    }
    async goTo({ index, anchor = 0, select }) {
        const generation = ++this.#generation
        this.#busy = true
        this.#error = null
        this.#snapshot = null
        try {
            if (!this.#views.get(index)?.loaded) {
                for (const [i] of this.#views) this.#drop(i)
                this.#layout = null
                await this.#load(index, generation)
            }
            if (this.#disposed || generation !== this.#generation) return
            this.#primary = index
            const view = this.#views.get(index)
            const resolved = typeof anchor === 'function' ? anchor(view.document) : anchor
            this.scrollToAnchor(resolved, select)
        } catch (error) {
            if (!this.#disposed && generation === this.#generation) throw error
        } finally {
            if (generation === this.#generation) this.#busy = false
        }
        if (!this.#disposed && generation === this.#generation) {
            this.capture()
            void this.fill()
        }
    }
    scrollToAnchor(anchor, select = false) {
        let index = this.#primary
        const doc = anchor?.startContainer?.ownerDocument ?? anchor?.ownerDocument
        if (doc) {
            const found = this.entries.find(([, view]) => view.document === doc)
            if (!found) throw new Error('Scroll target document is not mounted')
            index = found[0]
        }
        const view = this.#views.get(index)
        const rects = uncollapse(anchor)?.getClientRects?.()
        const rect = rects && (Array.from(rects).find(r => r.width > 0 && r.height > 0) ?? rects[0])
        const local = rect ? this.mapper(view)(rect).left - this.#layout.margin
            : Number(anchor) * view.element.getBoundingClientRect()[this.side]
        this.position = this.offset(index) + local
        this.report(select ? 'selection' : 'navigation')
    }
    async fill() {
        if (this.#disposed || this.#busy || this.#error || !this.#views.size || this.size <= 0) return
        const generation = this.#generation
        let loaded = 0
        this.capture()
        this.#busy = true
        try {
            // Recycle both directions, never selected documents or the visible section.
            const pinned = this.entries.some(([, view]) => view.document.getSelection()?.type === 'Range')
            for (const [index, view] of this.entries) {
                if (pinned) break
                const start = this.offset(index), end = start + view.element.getBoundingClientRect()[this.side]
                if (index === this.#primary || view.document.getSelection()?.type === 'Range') continue
                if (end < this.position - this.size * (this.#views.size >= this.limit ? 0 : 6) || start > this.position + this.size * 7) {
                    this.#drop(index)
                    this.restore()
                }
            }
            // Bounded work even for a book consisting of tiny sections.
            for (let count = 0; count < 8 && this.#views.size < this.limit; count++) {
                const entries = this.entries
                const next = this.adjacent(entries.at(-1)[0], 1)
                const prev = this.adjacent(entries[0][0], -1)
                const index = this.total - this.position - this.size < this.size * 3 && next !== null
                    ? next : this.position < this.size * 3 && prev !== null ? prev : null
                if (index === null) break
                this.#status.hidden = false
                this.#status.disabled = true
                this.#status.textContent = '正在加载相邻章节…'
                this.container.append(this.#status)
                try { await this.#load(index, generation); loaded++ }
                catch (error) {
                    if (this.#disposed || generation !== this.#generation) return
                    if (this.#views.has(index)) this.#drop(index)
                    throw error
                }
                if (this.#disposed || generation !== this.#generation) return
                this.restore()
            }
            this.#status.hidden = true
        } catch (error) {
            this.#error = error
            this.#status.hidden = false
            this.#status.disabled = false
            this.#status.textContent = `章节加载失败：${error.message}。点击重试`
            this.host.dispatchEvent(new CustomEvent('section-error', { detail: { error } }))
        } finally {
            if (generation === this.#generation) {
                this.#busy = false
                if (!this.#disposed) {
                    this.capture()
                    // Loading a short chapter may not produce a scroll event at all.
                    if (loaded === 8 && this.#views.size < this.limit)
                        queueMicrotask(() => { if (generation === this.#generation) void this.fill() })
                }
            }
        }
    }
    render() {
        if (this.#disposed || !this.#layout || this.#busy) return
        this.capture()
        this.#busy = true
        try {
            this.#layout = this.layout({ vertical: this.#vertical, rtl: this.host.bookDir === 'rtl' })
            for (const [, view] of this.entries) view.render(this.#layout)
            this.restore()
        } finally { this.#busy = false }
        this.report('anchor')
        void this.fill()
    }
    getContents() {
        // Existing engine consumers use [0] for current chapter (TTS/media overlays).
        return this.entries.map(([index, view]) => ({ index, doc: view.document, overlayer: view.overlayer }))
            .sort((a, b) => Number(b.index === this.#primary) - Number(a.index === this.#primary))
    }
    step(dir, distance = this.size) {
        this.position += dir * distance
        this.report('scroll')
        return this.fill()
    }
    destroy() {
        this.#disposed = true
        this.#snapshot = null
        ++this.#generation
        this.#abort.abort()
        cancelAnimationFrame(this.#frame)
        for (const [index] of this.#views) this.#drop(index)
        this.#status.remove()
        this.container.style.display = ''
        this.container.style.flexDirection = ''
        this.container.style.overflowAnchor = ''
    }
}
