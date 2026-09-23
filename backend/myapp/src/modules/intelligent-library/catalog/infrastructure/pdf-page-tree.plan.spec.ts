import { DEFAULT_PAGE_TREE_FANOUT, planBalancedPageTree, type QpdfDict } from "./pdf-page-tree.plan";

const pageRefs = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${index + 10} 0 R`);

const pageValues = (refs: string[]): Map<string, QpdfDict> =>
  new Map(refs.map((ref) => [ref, { "/Type": "/Page", "/Parent": "2 0 R", "/Contents": "99 0 R" }]));

const plan = (count: number, fanout?: number) => {
  const refs = pageRefs(count);
  return {
    refs,
    result: planBalancedPageTree({
      pageRefs: refs,
      rootPagesRef: "2 0 R",
      rootPagesValue: {
        "/Type": "/Pages",
        "/Count": count,
        "/Kids": refs,
        "/MediaBox": [0, 0, 612, 792],
      },
      pageValues: pageValues(refs),
      maxObjectId: 500,
      fanout,
    }),
  };
};

/** 从计划里取出「引用 → 该对象的 /Kids」，只包含被覆盖写入的节点。 */
const kidsOf = (updates: Record<string, { value: QpdfDict }>, ref: string): string[] =>
  (updates[`obj:${ref}`]?.value["/Kids"] as string[] | undefined) ?? [];

describe("planBalancedPageTree", () => {
  it("keeps the root fanout bounded and preserves the page order", () => {
    const { refs, result } = plan(100);

    const rootKids = kidsOf(result.updates, "2 0 R");
    expect(rootKids.length).toBeLessThanOrEqual(DEFAULT_PAGE_TREE_FANOUT);
    expect(result.updates["obj:2 0 R"].value["/Count"]).toBe(100);

    // 深度优先展开整棵树，叶子顺序必须与原页序逐个对上，否则页码会错位。
    const flatten = (ref: string): string[] => {
      const kids = kidsOf(result.updates, ref);
      if (kids.length === 0) return [ref];
      return kids.flatMap(flatten);
    };
    expect(flatten("2 0 R")).toEqual(refs);
  });

  it("repoints every page /Parent at the node that actually lists it", () => {
    const { refs, result } = plan(100);

    // pdf.js 的 getPageIndex 是从页对象顺着 /Parent 往上找自己，父节点的 /Kids 里
    // 没有它就直接抛 "Kid reference not found in parent's kids."，点目录跳页会失败。
    for (const ref of refs) {
      const parent = result.updates[`obj:${ref}`].value["/Parent"] as string;
      expect(kidsOf(result.updates, parent)).toContain(ref);
    }
  });

  it("keeps /Count consistent at every level", () => {
    const { result } = plan(100);
    const countOf = (ref: string): number => {
      const kids = kidsOf(result.updates, ref);
      if (kids.length === 0) return 1;
      const total = kids.reduce((sum, kid) => sum + countOf(kid), 0);
      expect(result.updates[`obj:${ref}`].value["/Count"]).toBe(total);
      return total;
    };
    expect(countOf("2 0 R")).toBe(100);
  });

  it("preserves inheritable attributes on the root and drops only /Kids and /Count", () => {
    const { result } = plan(20);
    const root = result.updates["obj:2 0 R"].value;
    // 页对象通过 /Parent 链向根节点继承 /MediaBox，丢掉它部分页面会失去尺寸。
    expect(root["/MediaBox"]).toEqual([0, 0, 612, 792]);
    expect(root["/Type"]).toBe("/Pages");
  });

  it("keeps other page keys untouched while rewriting /Parent", () => {
    const { refs, result } = plan(20);
    expect(result.updates[`obj:${refs[0]}`].value).toMatchObject({
      "/Type": "/Page",
      "/Contents": "99 0 R",
    });
  });

  it("allocates new object ids strictly above the existing maximum", () => {
    const { result } = plan(50);
    const newIds = Object.keys(result.updates)
      .map((key) => Number(key.replace(/^obj:/u, "").split(" ")[0]))
      .filter((id) => id > 500);
    expect(Math.min(...newIds)).toBe(501);
    expect(result.maxObjectId).toBe(Math.max(...newIds));
  });

  it("handles a single page without building intermediate levels", () => {
    const { refs, result } = plan(1);
    expect(kidsOf(result.updates, "2 0 R")).toHaveLength(1);
    expect(kidsOf(result.updates, kidsOf(result.updates, "2 0 R")[0])).toEqual(refs);
  });

  it("rejects structurally impossible inputs", () => {
    expect(() => plan(0)).toThrow(/no pages/u);
    expect(() => plan(10, 1)).toThrow(/fanout/u);
    expect(() => planBalancedPageTree({
      pageRefs: ["10 0 R"],
      rootPagesRef: "2 0 R",
      rootPagesValue: {},
      pageValues: new Map(),
      maxObjectId: 5,
    })).toThrow(/missing from the qpdf dump/u);
  });
});
