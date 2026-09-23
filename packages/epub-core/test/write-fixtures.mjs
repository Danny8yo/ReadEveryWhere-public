import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fixtures, resourcesFor } from './fixtures.mjs'
const require = createRequire(new URL('../../../backend/myapp/package.json', import.meta.url))
const AdmZip = require('adm-zip')
const directory = new URL('../reports/epubs/', import.meta.url)
await mkdir(directory, { recursive: true })
for (const fixture of fixtures) {
    const zip = new AdmZip()
    for (const [path, text] of Object.entries(resourcesFor(fixture))) {
        zip.addFile(path, Buffer.from(text, 'utf8'))
        if (path === 'mimetype') zip.getEntry(path).header.method = 0
    }
    await writeFile(new URL(`${fixture.id}.epub`, directory), zip.toBuffer())
}
console.log(`Wrote ${fixtures.length} self-authored EPUB fixtures to ${directory.pathname}`)
