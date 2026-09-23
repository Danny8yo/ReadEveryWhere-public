import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile, mkdir } from 'node:fs/promises'
import { parseEpub } from '../src/node.js'
const require = createRequire(new URL('../../../backend/myapp/package.json', import.meta.url))
require('ts-node').register({ transpileOnly: true, project: new URL('../../../backend/myapp/tsconfig.json', import.meta.url).pathname })
const { EpubDocumentProjector } = require('./src/modules/intelligent-library/book-content/infrastructure/epub-document.projector.ts')
const { inspectorEpubFixtures } = require('./tools/book-document-inspector/fixtures/epub-fixtures.ts')
const { analyzeBookDocument } = require('./tools/book-document-inspector/analyze-book-document.ts')
const revision = { fileChecksum: 'fixture', extractorVersion: 'candidate-v5', normalizationVersion: 'candidate-v2' }
const results = []
for (const fixture of inspectorEpubFixtures) {
    const parsed = await parseEpub(fixture.epub)
    const candidate = new EpubDocumentProjector().project(700, revision, parsed)
    const report = await analyzeBookDocument(candidate, { fileName: `${fixture.id}.epub`, deterministic: true })
    assert.equal(candidate.tocQuality, fixture.expected.tocQuality, fixture.id)
    assert.equal(candidate.sections.length, fixture.expected.sectionCount, fixture.id)
    assert.equal(candidate.toc.length, fixture.expected.nodeCount, fixture.id)
    for (const [key, field] of [['labels','label'], ['levels','level'], ['paths','path'], ['sourceHeadingLevels','sourceHeadingLevel']])
        if (fixture.expected[key]) assert.deepEqual(candidate.toc.map(node => node[field]), fixture.expected[key], `${fixture.id}:${key}`)
    if (fixture.expected.provenance) assert.deepEqual(candidate.tocProvenance, fixture.expected.provenance, fixture.id)
    if (fixture.expected.parentLabels) assert.deepEqual(candidate.toc.map(node => node.parentNodeId ? candidate.toc.find(p => p.nodeId === node.parentNodeId).label : null), fixture.expected.parentLabels, fixture.id)
    assert.deepEqual(report.diagnostics.filter(item => item.severity === 'error'), [], fixture.id)
    results.push({ id: fixture.id, passed: true, chars: candidate.sections.reduce((n,s)=>n+s.charCount,0) })
}
await mkdir(new URL('../reports/', import.meta.url), { recursive: true })
await writeFile(new URL('../reports/book-documents.json', import.meta.url), JSON.stringify(results,null,2))
console.log(JSON.stringify(results,null,2))
