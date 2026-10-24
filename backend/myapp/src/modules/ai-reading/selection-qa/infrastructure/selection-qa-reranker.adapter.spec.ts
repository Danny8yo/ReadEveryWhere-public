import { contentIndexPipeline } from "../../../intelligent-library/book-content/infrastructure/keyword-index-worker.adapter";
import { selectionQaSearchMode } from "./selection-qa-reranker.adapter";

describe("search mode and pipeline settings", () => {
  const reranker = { identity: { provider: "p", model: "m" }, rank: jest.fn() };
  it("empty values mean the defaults; unknown values and none-without-reranker fail at startup", () => {
    expect(contentIndexPipeline("")).toBe("unigram-v4");
    expect(contentIndexPipeline(undefined)).toBe("unigram-v4");
    expect(() => contentIndexPipeline("dual")).toThrow("unigram-v4 or dual-v1");
    expect(selectionQaSearchMode({ enabled: false }, "")).toEqual({ reranker: null, screening: "llm" });
    expect(() => selectionQaSearchMode({ enabled: false }, "none")).toThrow("requires SELECTION_QA_RERANKER");
    expect(() => selectionQaSearchMode({ enabled: true, reranker }, "auto")).toThrow("llm or none");
    expect(selectionQaSearchMode({ enabled: true, reranker }, "none").screening).toBe("none");
  });
});
