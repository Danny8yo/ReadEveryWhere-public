import { prepareKeywordQueries } from "@readeverywhere/epub-core/keywords";
import { validateQueries, validateSearchArguments, stripHistoricalCitations } from "./selection-qa-query-policy";
describe("model-owned bounded queries", () => {
  it("uses only model queries, normalizes NFC/space and removes duplicates", () => {
    expect(validateQueries([" SSD  随机I/O ", "SSD 随机I/O", "cafe\u0301"])).toEqual(["SSD 随机I/O", "café"]);
  });
  it.each([[], [""], ["x".repeat(129)], ["𠮷".repeat(65)], [1], ["a","b","c","d","e"], [Array.from({length: 30}, (_, i) => "t" + i).join(" ")]].map(value => ({ value })))("rejects invalid queries without truncating: %j", ({ value }) => {
    expect(() => validateQueries(value)).toThrow("TOOL_ARGUMENTS_INVALID");
  });
  it("keeps actual queries within the shared FTS budget", () => {
    expect(() => prepareKeywordQueries(validateQueries(["SSD 随机I/O", "闪存 擦除 写放大", "固态硬盘 写入 寿命", "缓存 刷盘"]))).not.toThrow();
  });
  it("strips historical citation markers", () => {
    expect(stripHistoricalCitations("answer [[evidence:old]] then [[evidence:unfinished")).toBe("answer  then ");
  });
});

describe("fixed search slots", () => {
  const args = (query1: unknown) => ({ informationNeed: "主题", queries: { query1, query2: "", query3: "", query4: "" } });
  it("accepts four explicit slots and retains every filled query", () => {
    expect(validateSearchArguments({ informationNeed: "主题", queries: { query1: "临时表", query2: "I/O", query3: "锁", query4: "" } })).toEqual(["临时表", "I/O", "锁"]);
  });
  it.each(["", " ", "x".repeat(129), "/", 123])("rejects invalid primary slot %s", value => {
    expect(() => validateSearchArguments(args(value))).toThrow("TOOL_ARGUMENTS_INVALID");
  });
  it("rejects extra slots instead of silently dropping queries", () => {
    const input = args("词");
    expect(() => validateSearchArguments({ ...input, queries: { ...input.queries, query5: "更多" } })).toThrow("TOOL_ARGUMENTS_INVALID");
  });
  it("reports independent invalid slots together", () => {
    expect.assertions(1);
    try { validateSearchArguments({ informationNeed: "主题", queries: { query1: "x".repeat(129), query2: "/", query3: "", query4: "" } }); }
    catch (error) { expect(error).toMatchObject({ validations: [
      { field: "queries.query1", constraint: "length", actual: 129, minimum: 1, maximum: 128 },
      { field: "queries.query2.clauses[0]", constraint: "containsLetterOrNumber" },
    ] }); }
  });
});
