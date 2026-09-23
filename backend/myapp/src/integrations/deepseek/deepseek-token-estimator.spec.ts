import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DeepSeekTokenEstimator, resolveTokenizerArtifact } from "./deepseek-token-estimator";

describe("DeepSeekTokenEstimator official fixture", () => {
  const estimator = new DeepSeekTokenEstimator();

  it.each([
    ["中文阅读", [21134, 8506]],
    ["Read everywhere", [8158, 21602]],
    ["AI 阅读 tool call", [13503, 223, 8506, 4105, 1926]],
    ['{"name":"book_read","result":"证据"}', [24313, 2852, 16562, 4835, 67129, 10177, 9001, 16562, 16432, 62773]],
  ])("encodes %s with the pinned official tokenizer", (text, expected) => {
    expect(estimator.encode(text as string)).toEqual(expected);
  });

  it("loads from source and a build-compatible dist asset location", () => {
    expect(existsSync(resolveTokenizerArtifact())).toBe(true);
    const distAsset = resolve(
      process.cwd(),
      "dist",
      "integrations",
      "deepseek",
      "assets",
      "deepseek-v3",
      "tokenizer.json",
    );
    if (existsSync(resolve(process.cwd(), "dist"))) expect(existsSync(distAsset)).toBe(true);
  });
});
