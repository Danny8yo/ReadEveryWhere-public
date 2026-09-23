// Self-authored input and gold strings. Never derive expected text from the mapper.
const wrap = body => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body>${body}</body></html>`
export const fixtures = [
    { id: 'repeated', body: '<p id="first">重复句子。</p><p id="second">重复句子。</p>', expected: '重复句子。\n重复句子。',
        selection: { selector: '#second', start: 0, end: 5, canonicalStart: 6, canonicalEnd: 11, quote: '重复句子。',
            oldCFI: 'epubcfi(/4/4[second],/1:0,/1:5)' } },
    { id: 'render-resources', source: wrap('<p id="first" style="background-image:url(cover.svg)">重复句子。</p><p id="second">重复句子。</p>').replace('</head>', '<link rel="stylesheet" href="book.css"/></head>'), expected: '重复句子。\n重复句子。',
        selection: { selector: '#second', start: 0, end: 5, canonicalStart: 6, canonicalEnd: 11, quote: '重复句子。', oldCFI: 'epubcfi(/4/4[second],/1:0,/1:5)' } },
    { id: 'inline', body: '<p id="p">甲<span>乙<strong>丙</strong></span>丁</p>', expected: '甲乙丙丁' },
    { id: 'cross-paragraph', body: '<h1 id="h">标题</h1><p>第一段。</p><p>第二段。</p>', expected: '标题\n第一段。\n第二段。' },
    { id: 'table', body: '<table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></tbody></table>', legacyExpected: '甲乙\n丙丁', expected: '甲\n乙\n丙\n丁' },
    { id: 'pre-code', body: '<pre id="pre">  a\r\n  b\n</pre><p><code>x  y</code></p>', expected: '  a\n  b\nx  y' },
    { id: 'whitespace', body: '<p id="p">A&#160; \tB\r\nC</p>', expected: 'A B C' },
    { id: 'nfc', body: '<p id="p">Cafe\u0301</p>', expected: 'Café' },
    { id: 'nfc-inline', body: '<p>e<span>\u0301</span> 👩‍💻 😀</p>', expected: 'é 👩‍💻 😀' },
    { id: 'ruby-footnote', body: '<p><ruby>漢<rt>かん</rt></ruby><a href="#fn">1</a></p><aside id="fn">注释</aside>', expected: '漢かん1\n注释' },
    { id: 'image-alt', body: '<p>前<img src="cover.svg" alt="图示"/>后</p>', expected: '前[Image: 图示]后' },
    { id: 'empty', body: '', expected: '' },
    { id: 'excluded', body: '<script>throw new Error("BOOK_SCRIPT_EXECUTED")</script><style>p{color:red}</style><p>正文</p><noscript>隐藏</noscript><template>模板</template>', expected: '正文' },
    { id: 'fallback', source: '<html><head><title>Fallback</title></head><body><p id="p">A&nbsp; B<br>C</p></body></html>', expected: 'A B\nC', fallback: true, selection: { selector: '#p', start: 0, end: 4, canonicalStart: 0, canonicalEnd: 3, quote: 'A\u00a0 B', oldCFI: 'epubcfi(/4/2[p],/1:0,/1:4)' } },
    { id: 'html-no-charset', mediaType: 'text/html', source: '<!doctype html><html><head><title>HTML</title></head><body><p id="p">中文正文</p></body></html>', expected: '中文正文', selection: { selector: '#p', start: 1, end: 3, canonicalStart: 1, canonicalEnd: 3, quote: '文正', oldCFI: 'epubcfi(/4/2[p],/1:1,/1:3)' } },
    { id: 'html-charset', mediaType: 'text/html', source: '<!doctype html><html><head><meta charset="utf-8"><title>HTML</title></head><body><p id="p">中文正文</p></body></html>', expected: '中文正文', selection: { selector: '#p', start: 1, end: 3, canonicalStart: 1, canonicalEnd: 3, quote: '文正', oldCFI: 'epubcfi(/4/2[p],/1:1,/1:3)' } },
    { id: 'cdata', body: '<p id="p">甲<![CDATA[乙]]>丙</p>', expected: '甲乙丙' },
    { id: 'xml-comment', body: '<p id="p">甲<!-- comment -->乙</p>', expected: '甲乙' },
].map(f => ({ ...f, source: f.source ?? wrap(f.body), mediaType: f.mediaType ?? 'application/xhtml+xml' }))

export function resourcesFor(fixture, toc = 'nav') {
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章</a><ol><li><a href="second.xhtml">第二章</a></li></ol></li></ol></nav></body></html>'
    const ncx = '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Fixture</text></docTitle><navMap><navPoint id="a" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="chapter.xhtml"/><navPoint id="b" playOrder="2"><navLabel><text>第二章</text></navLabel><content src="second.xhtml"/></navPoint></navPoint></navMap></ncx>'
    return {
        'OPS/cover.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        'OPS/book.css': 'p { color: black; background-image: url(cover.svg) }',
        'mimetype': 'application/epub+zip',
        'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'OPS/package.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">self-authored-fixture</dc:identifier><dc:title>定位测试</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="cover" href="cover.svg" media-type="image/svg+xml"/><item id="css" href="book.css" media-type="text/css"/><item id="c" href="chapter.xhtml" media-type="${fixture.mediaType}"/><item id="empty" href="empty.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="c"/><itemref idref="empty" linear="no"/><itemref idref="second"/></spine></package>`.replace(toc === 'ncx' ? 'properties="nav"' : '__unused__', ''),
        'OPS/chapter.xhtml': fixture.source,
        'OPS/empty.xhtml': wrap(''),
        'OPS/second.xhtml': wrap('<h1>第二章</h1><p>跨资源正文</p>'),
        'OPS/nav.xhtml': nav,
        'OPS/toc.ncx': ncx,
    }
}
