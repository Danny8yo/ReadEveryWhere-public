import { EPUB_EXTRACTOR_VERSION } from "@readeverywhere/epub-core";
import AdmZip from "adm-zip";
import { structureAt } from "../application/reader-tool.utils";
import { EpubDocumentExtractor } from "./epub-document.extractor";

describe("EpubDocumentExtractor TOC integrity", () => {
  const revision = {
    fileChecksum: "sha256:fixture",
    extractorVersion: EPUB_EXTRACTOR_VERSION,
    normalizationVersion: "epub-text-v1",
  };

  it("repairs a flat declared TOC whose repeated positions contradict one-section-per-chapter content", async () => {
    const extractor = new EpubDocumentExtractor();
    const document = await extractor.extract(42, brokenFlatTocEpub(3, 3), revision);

    expect(document.tocQuality).toBe("declared_repaired");
    expect(document.tocProvenance).toEqual({
      source: "ncx",
      positionStrategy: "repaired",
      hierarchyStrategy: "flat",
      headingMappedNodeCount: 0,
      inferredParentCount: 0,
    });
    expect(document.toc.map((node) => ({
      label: node.label,
      sectionIndex: node.sectionIndex,
      start: node.start,
      ownCharCount: node.ownCharCount,
      subtreeCharCount: node.subtreeCharCount,
    }))).toEqual([
      { label: "第1章", sectionIndex: 1, start: 0, ownCharCount: 1_200, subtreeCharCount: 1_200 },
      { label: "第2章", sectionIndex: 2, start: 0, ownCharCount: 1_200, subtreeCharCount: 1_200 },
      { label: "第3章", sectionIndex: 3, start: 0, ownCharCount: 1_200, subtreeCharCount: 1_200 },
    ]);
    expect(structureAt(document, 3, 100)?.path).toBe("第3章");
  });

  it("falls back to spine navigation when a broken declared TOC cannot be repaired unambiguously", async () => {
    const extractor = new EpubDocumentExtractor();
    const document = await extractor.extract(42, brokenFlatTocEpub(2, 3), revision);

    expect(document.tocQuality).toBe("spine_fallback");
    expect(document.tocProvenance).toEqual({
      source: "spine_fallback",
      positionStrategy: "spine_fallback",
      hierarchyStrategy: "spine_fallback",
      headingMappedNodeCount: 0,
      inferredParentCount: 0,
    });
    expect(document.toc).toHaveLength(5);
    expect(document.toc.map((node) => node.label)).not.toContain("第2章");
  });
});

function brokenFlatTocEpub(tocCount: number, chapterCount: number): Buffer {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`));

  const sectionNames = ["front.xhtml"];
  for (let index = 1; index <= chapterCount; index += 1) sectionNames.push(`chapter-${index}.xhtml`);
  sectionNames.push("copyright.xhtml");
  zip.addFile("front.xhtml", Buffer.from("<html><body><p>front</p></body></html>"));
  for (let index = 1; index <= chapterCount; index += 1) {
    zip.addFile(`chapter-${index}.xhtml`, Buffer.from(`<html><body><p>${String.fromCharCode(0x4e00 + index).repeat(1_200)}</p></body></html>`));
  }
  zip.addFile("copyright.xhtml", Buffer.from("<html><body><p>end</p></body></html>"));

  const manifest = sectionNames.map((name, index) => (
    `<item id="s${index}" href="${name}" media-type="application/xhtml+xml"/>`
  )).join("");
  const spine = sectionNames.map((_, index) => `<itemref idref="s${index}"/>`).join("");
  zip.addFile("content.opf", Buffer.from(`<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest}</manifest>
      <spine toc="ncx">${spine}</spine>
    </package>`));

  const navPoints = Array.from({ length: tocCount }, (_, index) => `
    <navPoint id="n${index + 1}">
      <navLabel><text>第${index + 1}章</text></navLabel>
      <content src="chapter-1.xhtml${index > 0 ? "#missing-anchor" : ""}"/>
    </navPoint>`).join("");
  zip.addFile("toc.ncx", Buffer.from(`<?xml version="1.0"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${navPoints}</navMap></ncx>`));
  return zip.toBuffer();
}
