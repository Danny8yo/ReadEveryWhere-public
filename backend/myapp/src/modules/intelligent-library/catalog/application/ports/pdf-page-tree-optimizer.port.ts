export interface PdfPageTreeOptimizeResult {
  /** 是否真的重建了页树。false 表示原文件原样保留（加密、结构异常、qpdf 报错等）。 */
  optimized: boolean;
  /** 重建会改变文件字节，落库大小以磁盘上的实际文件为准。 */
  fileSize: number;
  /** optimized 为 false 时给出原因，用于日志排查。 */
  skipReason?: string;
}

/**
 * 把 PDF 的页树重建成平衡树，让阅读器只读几个字节块就能打开大书。
 *
 * 背景：pdf.js 在 getDocument() 返回之前必然会取到最后一页（checkLastPage），而它只能靠
 * /Pages 节点上的 /Count 跳过子树。书源常见的「根节点直接挂几百个页对象」的扁平页树逼着它
 * 逐个抓取每一个页对象，这些页对象散落全书，于是打开一本 111MB 的书要先读掉 110MB。
 * 重建成扇出 8 的平衡树后，同一本书打开只读约 1MB。
 */
export interface PdfPageTreeOptimizerPort {
  optimize(absolutePath: string): Promise<PdfPageTreeOptimizeResult>;
}

export const PDF_PAGE_TREE_OPTIMIZER_PORT = Symbol(
  "INTELLIGENT_LIBRARY_PDF_PAGE_TREE_OPTIMIZER_PORT",
);
