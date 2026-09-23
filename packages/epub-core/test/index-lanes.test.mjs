import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { buildEpubIndex, readEpubContext } from "../src/node.js";
import { EPUB_EXTRACTOR_VERSION, NORMALIZATION_VERSION } from "../src/index.js";
function epub(length) {
  const zip = new AdmZip();
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  );
  zip.addFile(
    "book.opf",
    Buffer.from(
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="s" href="s.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="s"/></spine></package>',
    ),
  );
  zip.addFile(
    "s.xhtml",
    Buffer.from(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>' +
        "甲乙丙丁".repeat(Math.ceil(length / 4)).slice(0, length) +
        "</p></body></html>",
    ),
  );
  return zip.toBuffer();
}
test(
  "interactive context completes while bounded index lane waits on a batch",
  async () => {
    const bytes = epub(200_000),
      scope = {
        bookId: 1,
        fileChecksum:
          "sha256:" + createHash("sha256").update(bytes).digest("hex"),
        extractorVersion: EPUB_EXTRACTOR_VERSION,
        normalizationVersion: NORMALIZATION_VERSION,
      };
    let release, firstBatch;
    const arrived = new Promise((r) => (firstBatch = r)),
      hold = new Promise((r) => (release = r));
    let peak = process.memoryUsage().rss;
    const timer = setInterval(
      () => (peak = Math.max(peak, process.memoryUsage().rss)),
      5,
    );
    let finished = false;
    const indexing = buildEpubIndex(bytes, {
      timeoutMs: 60_000,
      onBatch: async () => {
        firstBatch();
        await hold;
      },
    }).then((result) => {
      finished = true;
      return result;
    });
    try {
      await Promise.race([arrived, indexing]);
      const start = performance.now();
      const result = await readEpubContext(
        bytes,
        scope,
        { sectionIndex: 0, href: "s.xhtml", start: 100, end: 120 },
        4000,
        { timeoutMs: 10_000 },
      );
      assert.equal(finished, false);
      assert.equal(result.length, 1);
      assert.ok(result[0].start <= 100 && result[0].end >= 120);
      console.log(
        JSON.stringify({
          laneContextMs: performance.now() - start,
          peakRssMiB: peak / 1024 / 1024,
          canonicalChars: 200000,
        }),
      );
    } finally {
      release();
      clearInterval(timer);
      await indexing;
    }
  },
  { timeout: 60_000 },
);
test("index workload limits are explicit without changing reader admission", async () => {
  assert.throws(
    () =>
      buildEpubIndex(new Uint8Array(64 * 1024 * 1024 + 1), {
        onBatch: () => {},
      }),
    { code: "INDEX_RESOURCE_LIMIT" },
  );
  const bytes = epub(750_000);
  await assert.rejects(buildEpubIndex(bytes, { onBatch: () => {} }), {
    code: "INDEX_RESOURCE_LIMIT",
  });
  const scope = {
    bookId: 1,
    fileChecksum: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    extractorVersion: EPUB_EXTRACTOR_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
  };
  assert.equal(
    (
      await readEpubContext(
        bytes,
        scope,
        { sectionIndex: 0, href: "s.xhtml", start: 1, end: 2 },
        100,
        { timeoutMs: 30_000 },
      )
    ).length,
    1,
  );
});


test("context accepts the full 12000-character QA contract without truncating its selection", async () => {
  const bytes = epub(16000);
  const scope = { bookId: 1, fileChecksum: "sha256:" + createHash("sha256").update(bytes).digest("hex"), extractorVersion: EPUB_EXTRACTOR_VERSION, normalizationVersion: NORMALIZATION_VERSION };
  for (const size of [5001, 12000]) {
    const [result] = await readEpubContext(bytes, scope, { sectionIndex: 0, href: "s.xhtml", start: 0, end: size }, size);
    assert.equal(result.quote.length, size); assert.equal(result.start, 0); assert.equal(result.end, size);
  }
  await assert.rejects(readEpubContext(bytes, scope, { sectionIndex: 0, href: "s.xhtml", start: 0, end: 12001 }, 12001));
});

test('configured RSS budget rejects an index before any batch is published', async () => {
  const values = { EPUB_INDEX_RSS_LIMIT_MIB: '16', EPUB_INDEX_HEAP_LIMIT_MIB: '4', EPUB_INTERACTIVE_HEAP_LIMIT_MIB: '8' };
  const old = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  let published = false;
  try {
    Object.assign(process.env, values);
    await assert.rejects(buildEpubIndex(epub(100), { onBatch: async () => { published = true; } }), { code: 'INDEX_RESOURCE_LIMIT' });
    assert.equal(published, false);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
