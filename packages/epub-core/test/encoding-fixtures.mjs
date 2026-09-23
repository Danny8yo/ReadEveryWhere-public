// Self-authored byte fixtures. All successful books contain the same manual text gold.
const html = head => `<html><head>${head}</head><body><p id="p">café</p></body></html>`
const xml = encoding => `<?xml version="1.0" encoding="${encoding}"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Encoding</title></head><body><p id="p">café</p></body></html>`
const utf16be = text => { const bytes = Buffer.from(text, 'utf16le'); return bytes.swap16() }
export const encodingFixtures = [
    { id: 'zip-windows1252-meta', bytes: Buffer.from(html('<meta charset="windows-1252">'), 'latin1'), mediaType: 'text/html' },
    { id: 'zip-windows1252-pragma', bytes: Buffer.from(html('<meta content="text/html; charset=windows-1252" http-equiv="Content-Type">'), 'latin1'), mediaType: 'text/html' },
    { id: 'zip-utf8-bom-over-meta', bytes: Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from(html('<meta charset="windows-1252">'))]), mediaType: 'text/html' },
    { id: 'zip-comment-not-declaration', bytes: Buffer.from(html('<!-- <meta charset="windows-1252"> -->')), mediaType: 'text/html' },
    { id: 'zip-attribute-not-declaration', bytes: Buffer.from(html('<title data-note=\'<meta charset="windows-1252">\'>Encoding</title>')), mediaType: 'text/html' },
    { id: 'zip-script-not-declaration', bytes: Buffer.from(html(`<script>const fake = '<meta charset="windows-1252">'</script>`)), mediaType: 'text/html' },
    { id: 'zip-style-not-declaration', bytes: Buffer.from(html(`<style>p::before { content: '<meta charset="windows-1252">' }</style>`)), mediaType: 'text/html' },
    { id: 'zip-xhtml-meta-not-encoding', bytes: Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="windows-1252"/></head><body><p id="p">café</p></body></html>'), mediaType: 'application/xhtml+xml' },
    { id: 'zip-xml-windows1252', bytes: Buffer.from(xml('windows-1252'), 'latin1'), mediaType: 'application/xhtml+xml' },
    { id: 'zip-utf8-bom-over-xml', bytes: Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from(xml('windows-1252'))]), mediaType: 'application/xhtml+xml' },
    { id: 'zip-utf16le-bom', bytes: Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(xml('UTF-16'), 'utf16le')]), mediaType: 'application/xhtml+xml' },
    { id: 'zip-utf16be-bom', bytes: Buffer.concat([Buffer.from([0xfe,0xff]), utf16be(xml('UTF-16'))]), mediaType: 'application/xhtml+xml' },
    { id: 'zip-utf16le-signature', bytes: Buffer.from(xml('UTF-16LE'), 'utf16le'), mediaType: 'application/xhtml+xml' },
    { id: 'zip-utf16be-signature', bytes: utf16be(xml('UTF-16BE')), mediaType: 'application/xhtml+xml' },
    { id: 'zip-invalid-utf8', bytes: Buffer.from(html(''), 'latin1'), mediaType: 'text/html', rejects: true },
    { id: 'zip-invalid-label', bytes: Buffer.from(html('<meta charset="not-an-encoding">')), mediaType: 'text/html', rejects: true },
    { id: 'zip-unsupported-utf32', bytes: Buffer.from([0xff,0xfe,0,0,0x3c,0,0,0]), mediaType: 'application/xhtml+xml', rejects: true },
]
