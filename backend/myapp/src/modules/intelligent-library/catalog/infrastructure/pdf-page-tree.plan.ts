/**
 * 由 qpdf JSON 描述的 PDF 结构，算出「把页树换成平衡树」需要覆盖哪些对象。
 *
 * 纯函数，不碰文件也不调用 qpdf，方便单测；实际的读写由
 * QpdfPageTreeOptimizerAdapter 通过 `qpdf --json` / `qpdf --update-from-json` 完成，
 * PDF 语法的序列化全部交给 qpdf，本模块只搬运 qpdf 自己产出的 JSON 值。
 */

export type QpdfDict = Record<string, unknown>;

export interface PageTreePlanInput {
  /** 按页序排列的页对象引用，形如 "3890 0 R" */
  pageRefs: readonly string[];
  /** 文档目录里 /Pages 指向的根节点引用 */
  rootPagesRef: string;
  /** 根节点当前的值，除 /Kids 与 /Count 外的键会被原样保留 */
  rootPagesValue: QpdfDict;
  /** 页对象引用 → 该对象当前的值 */
  pageValues: ReadonlyMap<string, QpdfDict>;
  /** 文件里已用的最大对象号，新节点从它之后开始分配 */
  maxObjectId: number;
  fanout?: number;
}

export interface PageTreePlan {
  maxObjectId: number;
  /** qpdf --update-from-json 的对象覆盖表，键形如 "obj:123 0 R" */
  updates: Record<string, { value: QpdfDict }>;
}

/**
 * 扇出取 8：树高约 log8(页数)，几百页的书只有两三层，中间节点总共几十个，
 * 和被改写的页对象一起被 qpdf 写在文件靠前的连续区域，遍历页树只需读一两个字节块。
 */
export const DEFAULT_PAGE_TREE_FANOUT = 8;

export function planBalancedPageTree(input: PageTreePlanInput): PageTreePlan {
  const fanout = input.fanout ?? DEFAULT_PAGE_TREE_FANOUT;
  if (!Number.isInteger(fanout) || fanout < 2) {
    throw new Error(`Page tree fanout must be an integer >= 2, received ${fanout}`);
  }
  if (input.pageRefs.length === 0) throw new Error("PDF has no pages");
  if (!Number.isInteger(input.maxObjectId) || input.maxObjectId < 1) {
    throw new Error(`Invalid maxObjectId: ${input.maxObjectId}`);
  }

  let nextObjectId = input.maxObjectId;
  const updates: Record<string, { value: QpdfDict }> = {};
  const allocate = (value: QpdfDict): string => {
    const ref = `${++nextObjectId} 0 R`;
    updates[`obj:${ref}`] = { value };
    return ref;
  };

  // 叶子层：每个叶子挂 fanout 个页对象，并把这些页对象的 /Parent 改指向它。
  // /Parent 必须跟着改，否则 pdf.js 的 getPageIndex 会从页对象往上找不到自己
  // （报 "Kid reference not found in parent's kids."），点目录跳页会直接失败。
  let level: { ref: string; count: number }[] = [];
  for (let index = 0; index < input.pageRefs.length; index += fanout) {
    const group = input.pageRefs.slice(index, index + fanout);
    const leafRef = allocate({ "/Type": "/Pages", "/Count": group.length, "/Kids": [...group] });
    for (const pageRef of group) {
      const pageValue = input.pageValues.get(pageRef);
      if (!pageValue) throw new Error(`Page object ${pageRef} is missing from the qpdf dump`);
      updates[`obj:${pageRef}`] = { value: { ...pageValue, "/Parent": leafRef } };
    }
    level.push({ ref: leafRef, count: group.length });
  }

  // 逐层向上收敛，直到根节点一层就能挂下。
  while (level.length > fanout) {
    const parents: { ref: string; count: number }[] = [];
    for (let index = 0; index < level.length; index += fanout) {
      const group = level.slice(index, index + fanout);
      const count = group.reduce((sum, node) => sum + node.count, 0);
      const parentRef = allocate({
        "/Type": "/Pages",
        "/Count": count,
        "/Kids": group.map((node) => node.ref),
      });
      for (const child of group) updates[`obj:${child.ref}`].value["/Parent"] = parentRef;
      parents.push({ ref: parentRef, count });
    }
    level = parents;
  }
  for (const node of level) updates[`obj:${node.ref}`].value["/Parent"] = input.rootPagesRef;

  // 根节点沿用原有的可继承属性（/MediaBox、/Resources、/Rotate 等）。页对象仍然通过
  // /Parent 链向上继承，把这些键丢掉会让部分页面失去 MediaBox。
  const inherited = { ...input.rootPagesValue };
  delete inherited["/Kids"];
  delete inherited["/Count"];
  updates[`obj:${input.rootPagesRef}`] = {
    value: {
      ...inherited,
      "/Count": input.pageRefs.length,
      "/Kids": level.map((node) => node.ref),
    },
  };

  return { maxObjectId: nextObjectId, updates };
}
