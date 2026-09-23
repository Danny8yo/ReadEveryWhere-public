import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import {
  EPUB_EXTRACTOR_VERSION,
  NORMALIZATION_VERSION,
} from "@readeverywhere/epub-core";

export const selectedText =
  "缓存把近期读取的结果保存在快速存储中，缓存命中后不必再次读取慢速源。";
export const searchEvidence =
  "事务原子性要求一笔转账的扣款和入账全部提交，或全部撤销，不允许只扣款。";
/** Authored fixtures only; no external book content. */
export function selfAuthoredEpub(
  title = "选区问答隔离测试",
  replacement = false,
) {
  const zip = new AdmZip();
  const escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const body = replacement
    ? "替换文件的正文，旧选择应当被冻结。"
    : selectedText;
  const sections = [
    body + "\n解释应当区分缓存与权威数据源。",
    "园中石阶连接凉亭，池边落叶随风轻摇。".repeat(60) +
      searchEvidence +
      "\n事务隔离描述并发读取之间的可见规则。" +
      "竹影映在窗边，远处传来轻微脚步声。".repeat(90),
  ];
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  );
  zip.addFile(
    "OPS/book.opf",
    Buffer.from(
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escape(title)}</dc:title><dc:creator>隔离测试作者</dc:creator><dc:language>zh</dc:language><dc:identifier>qa-test-${escape(title)}</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>${sections.map((_, i) => `<item id="s${i}" href="s${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine><itemref idref="s0"/><itemref idref="s1"/></spine></package>`,
    ),
  );
  zip.addFile(
    "OPS/nav.xhtml",
    Buffer.from(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head/><body><nav epub:type="toc"><ol><li><a href="s0.xhtml">缓存</a></li><li><a href="s1.xhtml">事务</a></li></ol></nav></body></html>',
    ),
  );
  sections.forEach((text, i) =>
    zip.addFile(
      `OPS/s${i}.xhtml`,
      Buffer.from(
        `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>${text
          .split("\n")
          .map(
            (p, j) =>
              `<p${i === 0 && j === 0 ? ' id="qa-selection"' : ""}>${escape(p)}</p>`,
          )
          .join("")}</body></html>`,
      ),
    ),
  );
  const bytes = zip.toBuffer();
  return {
    bytes,
    sections,
    checksum: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
  };
}
export function selectionRequest(bookId: number, checksum: string) {
  return {
    scope: {
      bookId,
      fileChecksum: checksum,
      extractorVersion: EPUB_EXTRACTOR_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      sectionIndex: 0,
      href: "OPS/s0.xhtml",
    },
    cfi: `epubcfi(/6/2!/4/2,/1:0,/1:${selectedText.length})`,
    displayedQuote: selectedText,
  };
}
