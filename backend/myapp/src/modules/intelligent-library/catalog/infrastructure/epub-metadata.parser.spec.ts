import AdmZip from "adm-zip";
import { EpubMetadataParser } from "./epub-metadata.parser";

function buildEpubBuffer(metadataXml: string, opfPath = "OEBPS/content.opf"): Buffer {
  const zip = new AdmZip();

  // container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.addFile("META-INF/container.xml", Buffer.from(containerXml, "utf-8"));

  // OPF
  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    ${metadataXml}
  </metadata>
  <manifest>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>`;
  zip.addFile(opfPath, Buffer.from(opfXml, "utf-8"));

  return zip.toBuffer();
}

describe("EpubMetadataParser", () => {
  let parser: EpubMetadataParser;

  beforeEach(() => {
    parser = new EpubMetadataParser();
  });

  it("returns null for non-zip buffer", () => {
    const result = parser.extract(Buffer.from("not a zip file"));
    expect(result).toBeNull();
  });

  it("rejects an EPUB zip without container.xml", () => {
    const zip = new AdmZip();
    zip.addFile("random.txt", Buffer.from("hello"));
    expect(() => parser.extract(zip.toBuffer())).toThrow("EPUB container.xml is missing");
  });

  it("extracts title from dc:title", () => {
    const buf = buildEpubBuffer(`<dc:title>被讨厌的勇气</dc:title>`);
    const result = parser.extract(buf);
    expect(result?.title).toBe("被讨厌的勇气");
  });

  it("extracts authors from dc:creator", () => {
    const buf = buildEpubBuffer(`
      <dc:creator>岸见一郎</dc:creator>
      <dc:creator>古贺史健</dc:creator>
    `);
    const result = parser.extract(buf);
    expect(result?.authors).toEqual(["岸见一郎", "古贺史健"]);
  });

  it("extracts ISBN from dc:identifier with urn:isbn prefix", () => {
    const buf = buildEpubBuffer(`<dc:identifier>urn:isbn:9787111495482</dc:identifier>`);
    const result = parser.extract(buf);
    expect(result?.isbn).toBe("9787111495482");
  });

  it("extracts ISBN-13 from dc:identifier with dashes", () => {
    const buf = buildEpubBuffer(`<dc:identifier>978-7-111-49548-2</dc:identifier>`);
    const result = parser.extract(buf);
    expect(result?.isbn).toBe("9787111495482");
  });

  it("extracts publisher from dc:publisher", () => {
    const buf = buildEpubBuffer(`<dc:publisher>机械工业出版社</dc:publisher>`);
    const result = parser.extract(buf);
    expect(result?.publisher).toBe("机械工业出版社");
  });

  it("extracts publishYear from dc:date", () => {
    const buf = buildEpubBuffer(`<dc:date>2016-05-01</dc:date>`);
    const result = parser.extract(buf);
    expect(result?.publishYear).toBe(2016);
  });

  it("extracts publishYear from dc:date with year only", () => {
    const buf = buildEpubBuffer(`<dc:date>2016</dc:date>`);
    const result = parser.extract(buf);
    expect(result?.publishYear).toBe(2016);
  });

  it("extracts description from dc:description", () => {
    const buf = buildEpubBuffer(`<dc:description>一本关于阿德勒心理学的通识读物</dc:description>`);
    const result = parser.extract(buf);
    expect(result?.description).toBe("一本关于阿德勒心理学的通识读物");
  });

  it("extracts language from dc:language", () => {
    const buf = buildEpubBuffer(`<dc:language>zh-CN</dc:language>`);
    const result = parser.extract(buf);
    expect(result?.language).toBe("zh-CN");
  });

  it("returns empty object when OPF has no dc metadata", () => {
    const buf = buildEpubBuffer("");
    const result = parser.extract(buf);
    expect(result).toEqual({});
  });
});
