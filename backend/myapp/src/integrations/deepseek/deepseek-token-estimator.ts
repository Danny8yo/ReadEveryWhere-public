import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import type { TokenEstimator } from "../../support/ai-model/public";

export const DEEPSEEK_V3_TOKENIZER_ID = "deepseek-v3-offline-2025-01-20";

export class DeepSeekTokenEstimator implements TokenEstimator {
  readonly tokenizerId = DEEPSEEK_V3_TOKENIZER_ID;
  private readonly tokenizer: Tokenizer;

  constructor(artifactPath = resolveTokenizerArtifact()) {
    if (!existsSync(artifactPath)) throw new Error(`TOKENIZER_ARTIFACT_MISSING:${artifactPath}`);
    try {
      const configPath = resolve(artifactPath, "..", "tokenizer_config.json");
      if (!existsSync(configPath)) throw new Error(`TOKENIZER_CONFIG_MISSING:${configPath}`);
      this.tokenizer = new Tokenizer(
        JSON.parse(readFileSync(artifactPath, "utf8")),
        JSON.parse(readFileSync(configPath, "utf8")),
      );
    } catch {
      throw new Error("TOKENIZER_ARTIFACT_INVALID");
    }
  }

  encode(value: string): number[] {
    if (!value) return [];
    return this.tokenizer.encode(value, { add_special_tokens: false }).ids;
  }

  count(value: string): number {
    return this.encode(value).length;
  }
}

export function resolveTokenizerArtifact(): string {
  const candidates = [
    resolve(__dirname, "assets", "deepseek-v3", "tokenizer.json"),
    resolve(process.cwd(), "src", "integrations", "deepseek", "assets", "deepseek-v3", "tokenizer.json"),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}
