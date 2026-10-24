import { QaCoverage } from "./qa-coverage";
describe("verified run coverage", () => {
  it("counts overlapping parent/child and duplicate evidence once and retains observed gaps", () => {
    const coverage = new QaCoverage();
    coverage.target("parent", [{ sectionIndex: 0, start: 0, end: 100 }]);
    coverage.target("child", [{ sectionIndex: 0, start: 20, end: 40 }]);
    coverage.record({ sectionIndex: 0, start: 20, end: 40 });
    coverage.record({ sectionIndex: 0, start: 20, end: 40 });
    coverage.record({ sectionIndex: 0, start: 0, end: 30 });
    coverage.limitation({ reason: "UNREPRESENTABLE_RANGE", start: 40, end: 42 });
    expect(coverage.snapshot()).toMatchObject({ uniqueReadChars: 40, targets: [{ nodeId: "parent", complete: false, unread: [{ sectionIndex: 0, start: 40, end: 100 }] }, { nodeId: "child", complete: true }] });
    coverage.record({ sectionIndex: 0, start: 40, end: 100 });
    expect(coverage.snapshot().uniqueReadChars).toBe(100);
    expect(coverage.snapshot().observedLimitations).toHaveLength(1);
  });
  it("a last batch alone never proves whole chapter coverage", () => {
    const c = new QaCoverage();
    c.target("chapter", [{ sectionIndex: 0, start: 0, end: 100 }, { sectionIndex: 1, start: 0, end: 50 }]);
    c.record({ sectionIndex: 1, start: 0, end: 50 });
    expect(c.snapshot().targets[0]).toMatchObject({ complete: false, unread: [{ sectionIndex: 0, start: 0, end: 100 }] });
  });
});
