import test from 'node:test'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { decodeEpubText } from '../src/decode.js'
import { openEpubArchive } from '../src/node-zip.js'
import { encodingFixtures } from './encoding-fixtures.mjs'
for (const fixture of encodingFixtures) test(`shared byte decoder: ${fixture.id}`, () => {
    const zip = new AdmZip(); zip.addFile('chapter.xhtml', fixture.bytes)
    const archive = openEpubArchive(zip.toBuffer())
    if (fixture.rejects) {
        assert.throws(() => decodeEpubText(fixture.bytes, fixture.mediaType))
        assert.throws(() => archive.text('chapter.xhtml', fixture.mediaType))
    } else {
        assert.match(decodeEpubText(fixture.bytes, fixture.mediaType), /café/)
        assert.equal(archive.text('chapter.xhtml', fixture.mediaType), decodeEpubText(fixture.bytes, fixture.mediaType))
    }
})
test('CSS declarations share decoding but other text defaults to strict UTF-8', () => {
    assert.equal(decodeEpubText(Buffer.from('@charset "windows-1252"; p::after { content: "café" }', 'latin1'), 'text/css'), '@charset "windows-1252"; p::after { content: "café" }')
    assert.throws(() => decodeEpubText(new Uint8Array([0xe9]), 'text/plain'))
})

test('CSS/plain text cannot select encoding from markup-like content', () => {
    const input = Buffer.from('/* <meta charset="windows-1252"> */ café')
    for (const mediaType of ['text/css', 'text/plain']) assert.equal(decodeEpubText(input, mediaType), '/* <meta charset="windows-1252"> */ café')
})
