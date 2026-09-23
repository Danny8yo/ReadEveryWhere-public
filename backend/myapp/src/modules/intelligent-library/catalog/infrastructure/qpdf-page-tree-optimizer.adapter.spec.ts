import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QpdfPageTreeOptimizerAdapter } from "./qpdf-page-tree-optimizer.adapter";
import { DEFAULT_PAGE_TREE_FANOUT } from "./pdf-page-tree.plan";

/**
 * 造一本「根 /Pages 直接挂 N 个页对象」的扁平页树 PDF —— 这正是书源 PDF 的常见形状，
 * 也是 pdf.js 打开时被迫读完整本书的原因。
 */
function buildFlatPageTreePdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageRefs: string[] = [];
  // 1 = 目录，2 = 根 /Pages，之后每页占两个对象（页字典 + 内容流）
  for (let index = 0; index < pageCount; index += 1) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageRefs.push(`${pageId} 0 R`);
    const content = `1 0 0 RG 10 ${10 + index} 100 100 re S\n`;
    // /StructParents 存页序号：qpdf 重写时会重新编号对象，靠对象号判断顺序不作数，
    // 页字典里的这个标记才是稳定的身份。
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] `
      + `/StructParents ${index} /Resources << >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [ ${pageRefs.join(" ")} ] >>`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref, "latin1");
}

interface QpdfDump {
  qpdf: [unknown, Record<string, { value?: Record<string, unknown> }>];
  pages: { object: string }[];
}

const dump = (path: string): QpdfDump => JSON.parse(
  execFileSync("qpdf", ["--json", "--json-key=qpdf", "--json-key=pages", path]).toString(),
) as QpdfDump;

describe("QpdfPageTreeOptimizerAdapter", () => {
  const adapter = new QpdfPageTreeOptimizerAdapter();
  let root: string;

  beforeAll(async () => {
    // qpdf 是运行时硬依赖（缺了应用启动就会崩），这里顺带把探测跑一遍。
    await adapter.onModuleInit();
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "read-everywhere-pagetree-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writePdf = (pageCount: number): string => {
    const path = join(root, "book.pdf");
    writeFileSync(path, buildFlatPageTreePdf(pageCount));
    return path;
  };

  it("replaces a flat page tree with a balanced one and reports the stored file facts", async () => {
    const path = writePdf(60);
    const before = dump(path);
    expect((before.qpdf[1]["obj:2 0 R"].value!["/Kids"] as string[])).toHaveLength(60);

    const result = await adapter.optimize(path);

    expect(result).toMatchObject({ optimized: true });
    expect(result.skipReason).toBeUndefined();
    const stored = readFileSync(path);
    expect(result.fileSize).toBe(stored.byteLength);

    const after = dump(path);
    expect(after.pages).toHaveLength(60);
    expect((after.qpdf[1]["obj:2 0 R"].value!["/Kids"] as string[]).length)
      .toBeLessThanOrEqual(DEFAULT_PAGE_TREE_FANOUT);
    expect(after.qpdf[1]["obj:2 0 R"].value!["/Count"]).toBe(60);
  });

  it("keeps every page reachable from its own /Parent", async () => {
    const path = writePdf(60);
    await adapter.optimize(path);

    // pdf.js 的 getPageIndex 从页对象顺着 /Parent 往上找自己；父节点 /Kids 里没有它，
    // 点目录跳页就会报 "Kid reference not found in parent's kids."
    const after = dump(path);
    for (const page of after.pages) {
      const parent = after.qpdf[1][`obj:${page.object}`].value!["/Parent"] as string;
      expect(after.qpdf[1][`obj:${parent}`].value!["/Kids"]).toContain(page.object);
    }
  });

  it("preserves page order", async () => {
    const path = writePdf(30);
    await adapter.optimize(path);
    const after = dump(path);
    const order = after.pages.map(
      (page) => after.qpdf[1][`obj:${page.object}`].value!["/StructParents"],
    );
    expect(order).toEqual(Array.from({ length: 30 }, (_, index) => index));
  });

  it("produces a file qpdf itself considers structurally sound", async () => {
    const path = writePdf(40);
    await adapter.optimize(path);
    expect(() => execFileSync("qpdf", ["--check", path], { stdio: "pipe" })).not.toThrow();
  });

  it("leaves an unreadable file untouched and reports why", async () => {
    const path = join(root, "broken.pdf");
    writeFileSync(path, Buffer.from("%PDF-1.4\nnot really a pdf\n"));
    const before = readFileSync(path);

    const result = await adapter.optimize(path);

    expect(result.optimized).toBe(false);
    expect(result.skipReason).toBeTruthy();
    // 书源文件质量不可控：结构坏掉的书保留原样，只是打开仍然慢，不能让导入整体失败。
    expect(readFileSync(path)).toEqual(before);
    expect(result.fileSize).toBe(before.byteLength);
  });
});
