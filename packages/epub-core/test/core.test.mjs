import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import * as core from '../src/index.js'
import { fixtures } from './fixtures.mjs'

const host = new JSDOM('') // No runScripts/resources options: scripts and network disabled.
const parser = new host.window.DOMParser()
const setup = id => {
    const fixture = fixtures.find(f => f.id === id)
    const { document } = core.parseChapter(fixture.source, fixture.mediaType, parser)
    return { document, map: core.buildSourceMap(document) }
}
const source = (node, start, end) => ({ start: { path: core.addressOf(node), offset: start }, end: { path: core.addressOf(node), offset: end } })
const scope = { bookId: 1, fileChecksum: 'sha256:fixture', extractorVersion: 'experiment',
    normalizationVersion: core.NORMALIZATION_VERSION, sectionIndex: 0, href: 'OPS/chapter.xhtml' }
for (const fixture of fixtures) test(`gold text: ${fixture.id}`, () => {
    const { document, effectiveMediaType } = core.parseChapter(fixture.source, fixture.mediaType, parser)
    const map = core.buildSourceMap(document)
    assert.equal(map.text, fixture.expected)
    assert.equal(effectiveMediaType, fixture.fallback ? 'text/html' : fixture.mediaType)
    for (const atom of map.segments.filter(a => a.start && a.end)) {
        const canonical = { start: atom.canonicalStart, end: atom.canonicalEnd }
        const restored = core.canonicalToSource(map, canonical)
        assert.deepEqual(core.sourceToCanonical(map, restored), { ...canonical, quote: atom.text })
    }
})
test('repeat identity uses second DOM address, old quote alone cannot relocate', () => {
    const { document, map } = setup('repeated')
    const selection = source(document.querySelector('#second').firstChild, 0, 5)
    const request = { scope, source: selection, displayedQuote: '重复句子。' }
    assert.equal(core.resolveSelection(document, map, scope, request).start, 6)
    for (const [key, value] of Object.entries({ bookId: 2, sectionIndex: 2, href: 'OPS/other.xhtml', fileChecksum: 'sha256:changed', extractorVersion: 'other' })) {
        assert.throws(() => core.resolveSelection(document, map, scope, { ...request, scope: { ...scope, [key]: value } }), { code: 'SCOPE_MISMATCH' })
    }
    assert.throws(() => core.resolveSelection(document, map, scope, { ...request, displayedQuote: '伪造' }), { code: 'QUOTE_MISMATCH' })
    assert.throws(() => core.resolveSelection(document, map, scope, { ...request, scope: { ...scope, normalizationVersion: 'other' } }), { code: 'VERSION_MISMATCH' })
})
test('reject partial NFC, surrogate/grapheme, and collapsed whitespace', () => {
    for (const [id, selector, start, end] of [['nfc', '#p', 3, 4], ['whitespace', '#p', 2, 3], ['nfc-inline', 'p', 0, 1]]) {
        const { document, map } = setup(id)
        assert.throws(() => core.sourceToCanonical(map, source(document.querySelector(selector).firstChild, start, end)), { code: 'UNREPRESENTABLE_RANGE' })
    }
    const { map } = setup('nfc-inline')
    assert.throws(() => core.canonicalToSource(map, { start: 3, end: 4 }), { code: 'UNREPRESENTABLE_RANGE' })
})
test('synthetic image text has provenance and cannot be selected as a source text node', () => {
    const { map } = setup('image-alt')
    assert.equal(map.segments.find(s => s.kind === 'image-alt').text, '[Image: 图示]')
    assert.throws(() => core.canonicalToSource(map, { start: 1, end: 12 }), { code: 'UNREPRESENTABLE_RANGE' })
})
test('cross paragraph range restores identical DOM endpoints', () => {
    const { document, map } = setup('cross-paragraph')
    const ps = document.querySelectorAll('p')
    const selection = { start: source(ps[0].firstChild, 1, 1).start, end: source(ps[1].firstChild, 3, 3).end }
    const range = core.sourceToCanonical(map, selection)
    assert.equal(range.quote, '一段。\n第二段')
    assert.deepEqual(core.canonicalToSource(map, range), selection)
})
test('no DOM mutation or source-marker collisions', () => {
    const { document } = core.parseChapter('<html><body><p>REWANCHOR0END REWPRE0END</p></body></html>', 'text/html', parser)
    const before = document.documentElement.outerHTML
    assert.equal(core.buildSourceMap(document).text, 'REWANCHOR0END REWPRE0END')
    assert.equal(document.documentElement.outerHTML, before)
})
test('Node 24 CommonJS loads same ESM source without transpiler', () => {
    assert.equal(createRequire(import.meta.url)('../src/index.js').parseChapter, core.parseChapter)
})
test('FTS5 is usable in an isolated in-memory database', () => {
    const db = new DatabaseSync(':memory:')
    try {
        db.exec('CREATE VIRTUAL TABLE probe USING fts5(text)')
        db.prepare('INSERT INTO probe(text) VALUES (?)').run('中文 fixture')
        assert.equal(db.prepare('SELECT count(*) n FROM probe WHERE probe MATCH ?').get('fixture').n, 1)
    } finally { db.close() }
})

test('existing Foliate literal search preserves both repeated hits and offsets', async () => {
    const { search } = await import('../../../frontend/src/lib/foliate-js/search.js')
    const results = [...search(['重复句子。', '重复句子。'], '重复句子', { granularity: 'grapheme' })]
    assert.deepEqual(results.map(r => r.range), [
        { startIndex: 0, startOffset: 0, endIndex: 0, endOffset: 4 },
        { startIndex: 1, startOffset: 0, endIndex: 1, endOffset: 4 },
    ])
    assert.deepEqual(results.map(r => r.excerpt.match), ['重复句子', '重复句子'])
})

test('v2 table cell boundaries deliberately differ from the retained P0 gold', () => {
    const fixture = fixtures.find(f => f.id === 'table')
    assert.equal(fixture.legacyExpected, '甲乙\n丙丁')
    assert.equal(fixture.expected, '甲\n乙\n丙\n丁')
    const { document, map } = setup('table')
    const cells = [...document.querySelectorAll('td')]
    assert.deepEqual(cells.map(cell => core.sourceToCanonical(map, source(cell.firstChild, 0, 1)).start), [0, 2, 4, 6])
})
test('compact linear runs preserve every interior UTF-16 endpoint', () => {
    const { document } = core.parseChapter('<html><body><p>甲乙abc丁</p></body></html>', 'text/html', parser)
    const map = core.buildSourceMap(document), node = document.querySelector('p').firstChild
    assert.equal(map.segments.length, 1)
    assert.equal(map.segments.data.byteLength, 32)
    for (let start = 0; start < node.length; start++) for (let end = start + 1; end <= node.length; end++) {
        const input = source(node, start, end)
        assert.deepEqual(core.canonicalToSource(map, core.sourceToCanonical(map, input)), input)
    }
})
test('compact exceptional boundaries still reject every interior of emoji/NFC/whitespace', () => {
    const { document } = core.parseChapter('<html><body><p>甲👩‍💻e\u0301  \t乙</p></body></html>', 'text/html', parser)
    const map = core.buildSourceMap(document), node = document.querySelector('p').firstChild
    for (const offset of [2, 3, 4, 5, 7, 9, 10]) {
        assert.throws(() => core.sourceToCanonical(map, source(node, 0, offset)), { code: 'UNREPRESENTABLE_RANGE' })
    }
    for (const offset of [2, 3, 4, 5]) assert.throws(() => core.canonicalToSource(map, { start: 0, end: offset }), { code: 'UNREPRESENTABLE_RANGE' })
})
test('heading and empty anchor offsets follow DOM order without quote matching', () => {
    const { document } = core.parseChapter('<html><body><h1 id="a"><span>同名</span></h1><a id="empty"></a><h2 id="b">同名</h2><a id="tail"></a></body></html>', 'text/html', parser)
    const map = core.buildSourceMap(document)
    assert.deepEqual(['a', 'empty', 'b', 'tail'].map(id => core.canonicalOffsetAtElement(map, document.getElementById(id))), [0, 3, 3, 5])
})
