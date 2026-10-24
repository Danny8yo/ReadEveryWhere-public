import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import AdmZip from 'adm-zip'
import { JSDOM } from 'jsdom'
import { buildSourceMap, canonicalToSource, sourceToCanonical, EPUB_EXTRACTOR_VERSION, NORMALIZATION_VERSION } from '../src/index.js'
import { chunkSection } from '../src/chunks.js'
import { buildEpubIndex, replayEpubRanges, expandEpubEvidence, readEpubContext } from '../src/node.js'
import { resourcesFor } from './fixtures.mjs'

const wrap = body => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Independent chunk regression</title></head><body>${body}</body></html>`
async function index(body) {
    const zip = new AdmZip()
    for (const [name, text] of Object.entries(resourcesFor({ source: wrap(body), mediaType: 'application/xhtml+xml' })))
        zip.addFile(name, Buffer.from(text))
    const bytes = zip.toBuffer(), chunks = []
    const result = await buildEpubIndex(bytes, { onBatch: batch => { chunks.push(...batch) } })
    const scope = { bookId: 99123, fileChecksum: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
        extractorVersion: EPUB_EXTRACTOR_VERSION, normalizationVersion: NORMALIZATION_VERSION }
    return { bytes, scope, result, chunks: chunks.filter(chunk => chunk.sectionIndex === 0) }
}
async function verifyEvidence(built) {
    const replayed = await replayEpubRanges(built.bytes, built.scope, built.chunks)
    for (let i = 0; i < built.chunks.length; i++) {
        const chunk = built.chunks[i], replay = replayed[i]
        assert.deepEqual([replay.start, replay.end, replay.href, replay.sectionIndex], [chunk.start, chunk.end, chunk.href, chunk.sectionIndex])
        assert.equal(replay.quote, chunk.quote)
        assert.equal(replay.quoteHash, chunk.quoteHash)
        assert.equal(replay.cfi, chunk.cfi)
        assert.equal(replay.displayedQuote, chunk.displayedQuote)
        assert.deepEqual(replay.source, chunk.source)
    }
}

test('an oversized synthetic alt inside a section is explicitly reported as an internal gap', async () => {
    const built = await index('<p>前<img alt="' + '图'.repeat(2500) + '"/>后</p>')
    assert.deepEqual(built.chunks.map(({ start, end, quote }) => ({ start, end, quote })), [
        { start: 0, end: 1, quote: '前' }, { start: 2510, end: 2511, quote: '后' },
    ])
    assert.ok(built.result.unavailable.some(gap => gap.sectionIndex === 0 && gap.start === 1 && gap.end === 2510 && gap.reason === 'SYNTHETIC_GAP'))
    await verifyEvidence(built)
})
test('pure synthetic text has no clickable range and is explicitly unavailable', async () => {
    const built = await index('<p><img alt="图"/></p>')
    assert.equal(built.chunks.length, 0)
    assert.ok(built.result.unavailable.some(gap => gap.sectionIndex === 0 && gap.start === 0 && gap.end === 10 && gap.reason === 'SYNTHETIC_ONLY'))
})
test('synthetic interior text and DOM displayed quote remain distinct during full CFI replay', async () => {
    const built = await index('<p>前<img alt="图"/>后</p>')
    assert.equal(built.chunks.length, 1)
    assert.equal(built.chunks[0].quote, '前[Image: 图]后')
    assert.equal(built.chunks[0].displayedQuote, '前后')
    await verifyEvidence(built)
})
test('identical repeated chunks at different positions preserve distinct source ranges and CFIs', async () => {
    const built = await index('<p>' + '重复句子。'.repeat(600) + '</p>')
    assert.deepEqual(built.chunks.map(c => [c.start, c.end]), [[0, 1200], [1195, 2395], [2390, 3000]])
    assert.equal(built.chunks[0].quote, built.chunks[1].quote)
    assert.notEqual(built.chunks[0].cfi, built.chunks[1].cfi)
    assert.notDeepEqual(built.chunks[0].source, built.chunks[1].source)
    await verifyEvidence(built)
})
test('inline NFC, emoji and collapsed whitespace cannot become partial chunk endpoints', async () => {
    const body = '<p>' + '甲'.repeat(1198) + 'e<span>\u0301</span>👩‍💻  <span>\t</span>' + '乙'.repeat(1500) + '</p>'
    const expected = '甲'.repeat(1198) + 'é👩‍💻 ' + '乙'.repeat(1500)
    const host = new JSDOM('')
    try {
        const document = new host.window.DOMParser().parseFromString(wrap(body), 'application/xhtml+xml')
        const map = buildSourceMap(document)
        assert.equal(map.text, expected)
        const boundaries = new Set([0, ...Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(expected), x => x.index + x.segment.length)])
        const built = await index(body)
        for (const chunk of built.chunks) {
            assert.ok(boundaries.has(chunk.start) && boundaries.has(chunk.end))
            assert.ok(chunk.end - chunk.start <= 1600)
            assert.deepEqual(sourceToCanonical(map, canonicalToSource(map, chunk)), { start: chunk.start, end: chunk.end, quote: chunk.quote })
        }
        await verifyEvidence(built)
    } finally { host.window.close() }
})
test('short tail is emitted once and no chunk is contained entirely in the previous overlap', async () => {
    const built = await index('<pre>' + '字'.repeat(1201) + '</pre>')
    assert.deepEqual(built.chunks.map(c => [c.start, c.end]), [[0, 1201]])
    await verifyEvidence(built)
})
test('one unbreakable grapheme larger than the cap fails explicitly instead of silently dropping it', async () => {
    await assert.rejects(index('<p>e' + '\u0301'.repeat(1700) + '</p>'), /CHUNK_UNREPRESENTABLE/)
})
test('boundary lookup keeps memory proportional to compact source records, not every UTF-16 unit', () => {
    // A paused generator keeps its boundary representation live across the measurement.
    // The 4 MiB bound allows DOM/string flattening but rejects two 1M-entry number arrays
    // (observed >20 MiB) or two expanded Uint32 arrays (8 MB). No timing threshold.
    const moduleURL = relative => new URL(relative, import.meta.url).href
    const script = `
      import { JSDOM } from ${JSON.stringify(moduleURL('../node_modules/jsdom/lib/api.js'))};
      import { buildSourceMap } from ${JSON.stringify(moduleURL('../src/index.js'))};
      import { chunkSection } from ${JSON.stringify(moduleURL('../src/chunks.js'))};
      const host = new JSDOM('<p>' + '甲'.repeat(1000000) + '</p>');
      globalThis.Node = host.window.Node; globalThis.NodeFilter = host.window.NodeFilter;
      const map = buildSourceMap(host.window.document);
      global.gc(); const before = process.memoryUsage();
      const iterator = chunkSection(host.window.document, map, 'epubcfi(/6/2)');
      const first = iterator.next().value;
      global.gc(); const after = process.memoryUsage();
      process.stdout.write(JSON.stringify({ records: map.segments.length, first: [first.start, first.end],
        retained: after.heapUsed - before.heapUsed + after.arrayBuffers - before.arrayBuffers }));
      iterator.return(); host.window.close();
    `
    const metrics = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15_000 }))
    assert.equal(metrics.records, 1)
    assert.deepEqual(metrics.first, [0, 1200])
    assert.ok(metrics.retained < 4 * 1024 * 1024, `Boundary lookup retained ${metrics.retained} bytes for one source record`)
})

test('paragraph boundary scanning is bounded per chunk on a long section without newlines', () => {
    const host = new JSDOM('<p>' + '字'.repeat(50_000) + '</p>')
    const map = buildSourceMap(host.window.document)
    const previousNode = globalThis.Node, previousFilter = globalThis.NodeFilter
    globalThis.Node = host.window.Node; globalThis.NodeFilter = host.window.NodeFilter
    const original = String.prototype.lastIndexOf
    let scannedUnits = 0
    try {
        // With no newline present, lastIndexOf must scan its entire eligible prefix.
        // Count that work rather than asserting a machine-dependent duration.
        String.prototype.lastIndexOf = function(search, from) {
            if (search === '\n') scannedUnits += Math.max(0, Math.min(this.length, from === undefined ? this.length : from + 1))
            return original.call(this, search, from)
        }
        const chunks = [...chunkSection(host.window.document, map, 'epubcfi(/6/2)')]
        assert.ok(chunks.length > 40)
        assert.ok(scannedUnits <= chunks.length * 500,
            `Paragraph lookup scanned ${scannedUnits} UTF-16 units for ${chunks.length} chunks`)
    } finally {
        String.prototype.lastIndexOf = original
        if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode
        if (previousFilter === undefined) delete globalThis.NodeFilter; else globalThis.NodeFilter = previousFilter
        host.window.close()
    }
})


test('paragraphs remain intact up to the soft ceiling and a heading starts a new group', async () => {
    const built = await index('<h2>第一节</h2><p>' + '甲'.repeat(1300) + '</p><h2>第二节</h2><p>独立主题。</p>');
    assert.ok(built.chunks.some(c => c.quote.includes('甲'.repeat(1300))));
    assert.ok(built.chunks.every(c => !(c.quote.includes('甲') && c.quote.includes('第二节'))));
    await verifyEvidence(built);
});
test('expanded evidence restores the preceding cause, merges neighboring hits, and replays exactly', async () => {
    const cause = '邦联主动禁止棉花出口，随后北方封锁阻止大部分棉花运出。';
    const built = await index('<h2>棉花与战争</h2><p>' + '背景。'.repeat(300) + '</p><p>' + cause + '</p><p>' + '1860年的380万包减少到1862年的几乎没有。由此产生的棉荒。'.repeat(35) + '</p><h2>另一主题</h2><p>不应跨入下一节。</p>');
    const hit = built.chunks.find(c => c.quote.includes('棉荒'));
    assert.ok(hit);
    const result = await expandEpubEvidence(built.bytes, built.scope, [hit, hit], { maxChars: 3000, maxWindowChars: 2400, limit: 5 });
    assert.equal(result.length, 1);
    assert.ok(result[0].quote.includes(cause));
    assert.ok(!result[0].quote.includes('另一主题'));
    assert.ok(result[0].start <= hit.start && result[0].end >= hit.end);
    const replay = await replayEpubRanges(built.bytes, built.scope, result);
    assert.equal(replay[0].cfi, result[0].cfi);
    assert.equal(replay[0].quoteHash, result[0].quoteHash);
    for (const bad of [{ ...hit, quote: 'wrong' }, { ...hit, displayedQuote: 'wrong' }, { ...hit, cfi: 'wrong' }, { ...hit, quoteHash: 'wrong' }])
        await assert.rejects(expandEpubEvidence(built.bytes, built.scope, [bad], { maxChars: 3000, maxWindowChars: 2400, limit: 5 }), /QUOTE_MISMATCH/);
});
test('expansion follows input ranking across sections and enforces a total budget', async () => {
    const built = await index('<p>' + '甲。'.repeat(900) + '</p><h2>第二主题</h2><p>' + '乙。'.repeat(900) + '</p>');
    const first = built.chunks.find(c => c.quote.includes('甲'));
    const second = built.chunks.find(c => c.quote.includes('乙'));
    const result = await expandEpubEvidence(built.bytes, built.scope, [second, first], { maxChars: 2000, maxWindowChars: 1800, limit: 2 });
    assert.ok(result[0].quote.includes('乙'));
    assert.ok(result.reduce((sum, e) => sum + e.quote.length, 0) <= 2000);
    await assert.rejects(expandEpubEvidence(built.bytes, built.scope, [{...first,sectionIndex:999}], { maxChars: 2000, maxWindowChars: 1800, limit: 2 }), /SCOPE_MISMATCH/);
});
test('initial selection context completes prose boundaries without losing the selected text', async () => {
    const built = await index('<h2>第一节</h2><p>开头的一句话。邦联禁止出口。北方封锁进一步阻断运输。由此产生棉荒。</p><h2>第二节</h2><p>无关文本。</p>');
    const hit = built.chunks.find(c => c.quote.includes('棉荒'));
    const start = hit.start + hit.quote.indexOf('棉荒');
    const [context] = await readEpubContext(built.bytes, built.scope, {sectionIndex:0,href:hit.href,start,end:start+2}, 200);
    assert.ok(context.quote.includes('邦联禁止出口。'));
    assert.ok(context.start <= start && context.end >= start+2);
    assert.ok(!context.quote.includes('无关文本'));
});


test('context completes the selected sentence inside a long paragraph', async () => {
    const sentence = '这句话解释禁运和封锁共同造成欧洲棉花供应骤降。';
    const built = await index('<p>' + '背景句。'.repeat(450) + sentence + '结尾句。'.repeat(450) + '</p>');
    const hit = built.chunks.find(c => c.quote.includes(sentence));
    const start = hit.start + hit.quote.indexOf('禁运');
    const [context] = await readEpubContext(built.bytes, built.scope, {sectionIndex:0,href:hit.href,start,end:start+2}, 100);
    assert.ok(context.quote.includes(sentence));
    assert.equal(context.quote.at(-1), '。');
});
test('oversized sentences disclose forced boundaries and tables keep whole rows when feasible', async () => {
    const built = await index('<p>' + '甲'.repeat(3000) + '</p><table>' + Array.from({length:4}, (_,i) => '<tr><td>行'+i+'</td><td>'+'乙'.repeat(500)+'</td></tr>').join('') + '</table>');
    assert.ok(built.chunks.filter(c => c.quote.includes('甲')).every(c => c.boundaryTruncated));
    for (let i=0;i<4;i++) assert.ok(built.chunks.some(c=>c.quote.includes('行'+i+'\n'+'乙'.repeat(500))));
    await verifyEvidence(built);
});

test('semantic section entry and exit fence chunks and context without headings', async () => {
    const built = await index('<p>外部前文。</p><section><p>第一小节内容。</p><section><p>嵌套小节内容。</p></section><p>第一小节续文。</p></section><section><p>第二小节内容。</p></section><p>外部后文。</p>');
    const texts = ['外部前文。', '第一小节内容。', '嵌套小节内容。', '第一小节续文。', '第二小节内容。', '外部后文。'];
    assert.deepEqual(built.chunks.map(c => c.quote), texts);
    for (const chunk of built.chunks) {
        const [context] = await readEpubContext(built.bytes, built.scope, chunk, 4000);
        assert.equal(context.quote, chunk.quote);
        assert.equal(context.contextTruncated, false);
    }
    await verifyEvidence(built);
});

test('initial context expands oversized unpunctuated source and discloses truncation through worker', async () => {
    const built = await index('<p>' + '甲'.repeat(5000) + '</p>');
    for (const [start, end, cap] of [[2000, 2005, 4000], [4990, 4995, 4000], [2000, 2005, 20]]) {
        const [context] = await readEpubContext(built.bytes, built.scope, { sectionIndex: 0, href: built.chunks[0].href, start, end }, cap);
        assert.ok(context.start <= start && context.end >= end);
        assert.equal(context.quote.length, cap);
        assert.equal(context.contextTruncated, true);
        const [replayed] = await replayEpubRanges(built.bytes, built.scope, [context]);
        assert.equal(replayed.quote, context.quote);
        assert.deepEqual(replayed.source, context.source);
        assert.equal(replayed.cfi, context.cfi);
    }
});

test('context fallback retains complete graphemes when its character target lands inside emoji', async () => {
    const built = await index('<p>' + '👨‍👩‍👧‍👦'.repeat(500) + '</p>');
    const [context] = await readEpubContext(built.bytes, built.scope, { sectionIndex: 0, href: built.chunks[0].href, start: 2200, end: 2211 }, 100);
    assert.ok(context.start <= 2200 && context.end >= 2211);
    assert.ok(context.quote.length > 11 && context.quote.length <= 100);
    assert.equal(context.quote, '👨‍👩‍👧‍👦'.repeat(context.quote.length / 11));
    assert.equal(context.contextTruncated, true);
    await replayEpubRanges(built.bytes, built.scope, [context]);
});

test('preserved semantic selections retain highly overlapping edge evidence and reserve every hit first', async () => {
    const built = await index('<p>' + '背景说明。'.repeat(600) + '</p>');
    const hits = [];
    for (const [start, end] of [[1088, 1699], [17, 1089], [2100, 2200]]) {
        const [hit] = await readEpubContext(built.bytes, built.scope, { sectionIndex: 0, href: built.chunks[0].href, start, end }, end - start);
        assert.deepEqual([hit.start, hit.end], [start, end]);
        hits.push(hit);
    }
    const required = hits.reduce((sum, hit) => sum + hit.quote.length, 0);
    for (const maxChars of [8000, required + 100, required]) {
        const output = await expandEpubEvidence(built.bytes, built.scope, hits, { maxChars, maxWindowChars: 1600, limit: 5, preserveAllHits: true });
        assert.equal(output.length, 3);
        assert.ok(output.reduce((sum, window) => sum + window.quote.length, 0) <= maxChars);
        hits.forEach((hit, rank) => {
            assert.ok(output[rank].start <= hit.start && output[rank].end >= hit.end);
            assert.deepEqual(output[rank].hitRanges, [{ sectionIndex: 0, start: hit.start, end: hit.end }]);
        });
        const replayed = await replayEpubRanges(built.bytes, built.scope, output);
        replayed.forEach((range, rank) => assert.equal(range.quote, output[rank].quote));
    }
    await assert.rejects(expandEpubEvidence(built.bytes, built.scope, hits, { maxChars: required - 1, maxWindowChars: 1600, limit: 5, preserveAllHits: true }), /CONTEXT_BUDGET_EXHAUSTED/);
    await assert.rejects(expandEpubEvidence(built.bytes, built.scope, hits, { maxChars: 8000, maxWindowChars: 1000, limit: 5, preserveAllHits: true }), /CONTEXT_BUDGET_EXHAUSTED/);
    assert.throws(() => expandEpubEvidence(built.bytes, built.scope, hits, { maxChars: 8000, maxWindowChars: 1600, limit: 2, preserveAllHits: true }), /Invalid evidence expansion budget/);
    await assert.rejects(expandEpubEvidence(built.bytes, built.scope, [{ ...hits[0], quoteHash: 'invalid' }], { maxChars: 8000, maxWindowChars: 1600, limit: 5, preserveAllHits: true }), /QUOTE_MISMATCH/);
});

test('preserved expansion accepts twelve selected ranges under one shared budget', async () => {
    const built = await index('<p>' + '检索证据。'.repeat(1200) + '</p>');
    const hits = [];
    for (let rank = 0; rank < 12; rank++) {
        const start = 100 + rank * 500;
        const [hit] = await readEpubContext(built.bytes, built.scope, { sectionIndex: 0, href: built.chunks[0].href, start, end: start + 20 }, 20);
        hits.push(hit);
    }
    const result = await expandEpubEvidence(built.bytes, built.scope, hits, { maxChars: 8000, maxWindowChars: 1600, limit: 12, preserveAllHits: true });
    assert.equal(result.length, 12);
    assert.ok(result.reduce((sum, window) => sum + window.quote.length, 0) <= 8000);
    hits.forEach((hit, rank) => assert.deepEqual(result[rank].hitRanges, [{ sectionIndex: 0, start: hit.start, end: hit.end }]));
    assert.throws(() => expandEpubEvidence(built.bytes, built.scope, [...hits, hits[0]], { maxChars: 8000, maxWindowChars: 1600, limit: 13, preserveAllHits: true }), /Invalid evidence expansion budget/);
});

test('dual index streams are produced in the worker for every chunk and match the shared tokenizers', async () => {
    const { tokenizeBigrams, tokenizeWords, tokenizeKeywords, DUAL_TOKENIZER_VERSION, TOKENIZER_VERSION } = await import('../src/keywords.js')
    const zip = new AdmZip()
    for (const [name, text] of Object.entries(resourcesFor({ source: wrap('<p>使用了临时表的查询会等待锁。</p><p>随机I/O比顺序访问慢。</p>'), mediaType: 'application/xhtml+xml' })))
        zip.addFile(name, Buffer.from(text))
    const bytes = zip.toBuffer(), dual = [], plain = []
    const result = await buildEpubIndex(bytes, { streams: 'dual', onBatch: batch => { dual.push(...batch) } })
    assert.equal(result.tokenizerVersion, DUAL_TOKENIZER_VERSION)
    assert.ok(dual.length > 0)
    for (const chunk of dual) {
        assert.equal(chunk.tokens, tokenizeKeywords(chunk.quote).join(' '))
        assert.equal(chunk.bigramTokens, tokenizeBigrams(chunk.quote).join(' '))
        assert.equal(chunk.wordTokens, tokenizeWords(chunk.quote, 'index').join(' '))
    }
    const charOnly = await buildEpubIndex(bytes, { onBatch: batch => { plain.push(...batch) } })
    assert.equal(charOnly.tokenizerVersion, TOKENIZER_VERSION)
    assert.ok(plain.every(chunk => chunk.bigramTokens === undefined && chunk.wordTokens === undefined))
    assert.deepEqual(plain.map(c => c.tokens), dual.map(c => c.tokens))
    assert.throws(() => buildEpubIndex(bytes, { streams: 'other', onBatch: () => {} }))
})
