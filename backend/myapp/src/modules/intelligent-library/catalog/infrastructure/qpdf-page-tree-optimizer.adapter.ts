import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { execFile } from "node:child_process";
import { rm, stat, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  PdfPageTreeOptimizeResult,
  PdfPageTreeOptimizerPort,
} from "../application/ports/pdf-page-tree-optimizer.port";
import { planBalancedPageTree, type QpdfDict } from "./pdf-page-tree.plan";

const execFileAsync = promisify(execFile);

/** qpdf --json 只输出对象结构不输出流数据，最大的测试书（111MB）也只有 1.3MB JSON。 */
const QPDF_JSON_MAX_BUFFER = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

interface QpdfObjectEntry {
  value?: QpdfDict;
}

interface QpdfDump {
  qpdf: [{ pdfversion: string; maxobjectid: number }, Record<string, QpdfObjectEntry>];
  pages: { object: string }[];
}

/**
 * 用 qpdf 把 PDF 的页树重建成平衡树。
 *
 * 读结构用 `qpdf --json`，写回用 `qpdf --update-from-json`：我们只在 qpdf 自己产出的 JSON
 * 上改 /Kids、/Count、/Parent，PDF 语法的序列化完全由 qpdf 负责，页内容、批注、目录都不经
 * 我们的手，因此不会被改坏。
 */
@Injectable()
export class QpdfPageTreeOptimizerAdapter implements PdfPageTreeOptimizerPort, OnModuleInit {
  private readonly logger = new Logger(QpdfPageTreeOptimizerAdapter.name);
  private readonly timeoutMs = readTimeoutMs();

  /**
   * 缺 qpdf 是部署配置错误而不是数据问题，启动就崩掉，别等到用户导入 PDF 才发现
   * 每本大书都要读几十兆。
   */
  async onModuleInit(): Promise<void> {
    try {
      await execFileAsync("qpdf", ["--version"], { timeout: this.timeoutMs });
    } catch (error) {
      throw new Error(
        "qpdf is required to normalize PDF page trees but is not runnable. "
        + "Install it (alpine: apk add qpdf, macOS: brew install qpdf). "
        + `Cause: ${(error as Error).message}`,
      );
    }
  }

  async optimize(absolutePath: string): Promise<PdfPageTreeOptimizeResult> {
    let skipReason: string | undefined;
    try {
      skipReason = await this.rebuild(absolutePath);
    } catch (error) {
      // 书源文件质量不可控：单本 PDF 结构异常不该让下载/导入整体失败，保留原文件即可，
      // 代价只是这一本打开仍然慢。原因记到日志里以便排查。
      skipReason = (error as Error).message;
    }
    if (skipReason) {
      this.logger.warn(`PDF page tree not rebuilt for ${absolutePath}: ${skipReason}`);
    }
    const { size } = await stat(absolutePath);
    return {
      optimized: !skipReason,
      fileSize: size,
      ...(skipReason ? { skipReason } : {}),
    };
  }

  /** 重建成功返回 undefined，跳过则返回原因。 */
  private async rebuild(absolutePath: string): Promise<string | undefined> {
    const dump = await this.dump(absolutePath);
    const [info, objects] = dump.qpdf;

    const trailer = objects.trailer?.value;
    if (!trailer) return "qpdf dump has no trailer";
    if (trailer["/Encrypt"]) return "encrypted PDF";

    const catalogRef = trailer["/Root"];
    if (typeof catalogRef !== "string") return "trailer has no /Root reference";
    const catalog = objects[`obj:${catalogRef}`]?.value;
    if (!catalog) return `catalog ${catalogRef} is not a dictionary`;

    const rootPagesRef = catalog["/Pages"];
    if (typeof rootPagesRef !== "string") return "catalog has no /Pages reference";
    const rootPagesValue = objects[`obj:${rootPagesRef}`]?.value;
    if (!rootPagesValue) return `root /Pages ${rootPagesRef} is not a dictionary`;

    const pageRefs = dump.pages.map((page) => page.object);
    if (pageRefs.length === 0) return "PDF has no pages";

    const pageValues = new Map<string, QpdfDict>();
    for (const pageRef of pageRefs) {
      const value = objects[`obj:${pageRef}`]?.value;
      if (!value) return `page object ${pageRef} is not a dictionary`;
      pageValues.set(pageRef, value);
    }

    const plan = planBalancedPageTree({
      pageRefs,
      rootPagesRef,
      rootPagesValue,
      pageValues,
      maxObjectId: info.maxobjectid,
    });

    const updatePath = `${absolutePath}.pagetree.json`;
    const outputPath = `${absolutePath}.pagetree.pdf`;
    try {
      await writeFile(updatePath, JSON.stringify({
        qpdf: [
          { jsonversion: 2, pdfversion: info.pdfversion, maxobjectid: plan.maxObjectId },
          plan.updates,
        ],
      }));
      await execFileAsync("qpdf", [`--update-from-json=${updatePath}`, absolutePath, outputPath], {
        timeout: this.timeoutMs,
        maxBuffer: QPDF_JSON_MAX_BUFFER,
      });
      await rename(outputPath, absolutePath);
      return undefined;
    } finally {
      await rm(updatePath, { force: true });
      await rm(outputPath, { force: true });
    }
  }

  private async dump(absolutePath: string): Promise<QpdfDump> {
    const { stdout } = await execFileAsync(
      "qpdf",
      ["--json", "--json-key=qpdf", "--json-key=pages", absolutePath],
      { timeout: this.timeoutMs, maxBuffer: QPDF_JSON_MAX_BUFFER },
    );
    return JSON.parse(stdout) as QpdfDump;
  }
}

function readTimeoutMs(): number {
  const raw = process.env.PDF_OPTIMIZE_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  // 配置写错时静默退化成「没有超时」比崩掉更难查：一本坏书能把导入请求挂死。
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`PDF_OPTIMIZE_TIMEOUT_MS must be a positive integer, received "${raw}"`);
  }
  return parsed;
}
