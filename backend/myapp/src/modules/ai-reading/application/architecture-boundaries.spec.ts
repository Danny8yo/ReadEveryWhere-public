import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AiModelSupportModule,
  LANGUAGE_MODEL_GATEWAY,
  MODEL_CONFIG_PORT,
  MODEL_PROFILE_REGISTRY,
  TOKEN_ESTIMATOR_REGISTRY,
} from "../../../support/ai-model/public";
import { ModelConfigService } from "../../../support/ai-model/application/model-config.service";
import { BookAnalysisModule } from "../../intelligent-library/book-analysis/book-analysis.module";
import { LanguageModelBookClassifierAdapter } from "../../intelligent-library/book-analysis/infrastructure/language-model-book-classifier.adapter";
import { AiReadingModule } from "../ai-reading.module";
import { AiModelSupportAdapter } from "../infrastructure/ai-model-support.adapter";
import { IntelligentLibraryBookAnalysisAdapter } from "../infrastructure/intelligent-library-book-analysis.adapter";
import { AgentRunExecutor } from "./agent-run-executor";
import { ReadingConversationService } from "./reading-conversation.service";
import { AI_READING_BOOK_ANALYSIS_PORT } from "./ports/book-analysis.port";
import { AI_READING_LANGUAGE_MODEL_PORT } from "./ports/language-model.port";
import { AI_READING_MODEL_CONFIG_PORT } from "./ports/model-config.port";
import { AI_READING_MODEL_RUNTIME_PORT } from "./ports/model-runtime.port";

describe("ai-reading architecture boundaries", () => {
  it("keeps domain and application production code independent from outer layers", () => {
    const roots = [join(__dirname), join(__dirname, "..", "domain")];
    const violations: string[] = [];

    for (const file of roots.flatMap(productionTypeScriptFiles)) {
      const source = readFileSync(file, "utf8");
      const forbidden = [
        [/@nestjs\/platform/u, "imports @nestjs/common"],
        [/support\/ai-model/u, "imports AI model Support"],
        [/modules\/intelligent-library|\.\.\/\.\.\/intelligent-library/u, "imports IntelligentLibrary"],
        [/common\/http/u, "imports HTTP concerns"],
        [/from\s+["'][^"']*infrastructure(?:\/[^"']*)?["']/u, "imports ai-reading infrastructure"],
      ] as const;
      for (const [pattern, reason] of forbidden) {
        if (pattern.test(source)) violations.push(`${file}: ${reason}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps ai-reading and book-analysis independent from DeepSeek implementations", () => {
    const roots = [
      join(__dirname, ".."),
      join(__dirname, "..", "..", "intelligent-library", "book-analysis"),
    ];
    const violations = roots.flatMap(productionTypeScriptFiles).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /deepseek-language-model\.adapter|deepseek-model-policy/iu.test(source)
        ? [`${file}: imports a DeepSeek implementation or policy`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("binds external public tokens only at ai-reading adapters", () => {
    const providers = Reflect.getMetadata("providers", AiReadingModule) as Array<Record<string, unknown>>;

    expect(injectedTokens(providers, AiModelSupportAdapter)).toEqual([
      LANGUAGE_MODEL_GATEWAY,
      MODEL_CONFIG_PORT,
      MODEL_PROFILE_REGISTRY,
      TOKEN_ESTIMATOR_REGISTRY,
    ]);
    expect(existingBinding(providers, AI_READING_LANGUAGE_MODEL_PORT)).toBe(AiModelSupportAdapter);
    expect(existingBinding(providers, AI_READING_MODEL_CONFIG_PORT)).toBe(AiModelSupportAdapter);
    expect(existingBinding(providers, AI_READING_MODEL_RUNTIME_PORT)).toBe(AiModelSupportAdapter);
    expect(existingBinding(providers, AI_READING_BOOK_ANALYSIS_PORT))
      .toBe(IntelligentLibraryBookAnalysisAdapter);
  });

  it("injects application services through ai-reading-owned ports", () => {
    const readingProviders = Reflect.getMetadata("providers", AiReadingModule) as Array<Record<string, unknown>>;
    const analysisProviders = Reflect.getMetadata("providers", BookAnalysisModule) as Array<Record<string, unknown>>;
    const modelProviders = Reflect.getMetadata("providers", AiModelSupportModule) as Array<Record<string, unknown>>;
    const modelExports = Reflect.getMetadata("exports", AiModelSupportModule) as unknown[];

    expect(injectedTokens(readingProviders, AgentRunExecutor)).toContain(AI_READING_LANGUAGE_MODEL_PORT);
    expect(injectedTokens(readingProviders, AgentRunExecutor)).toContain(AI_READING_MODEL_CONFIG_PORT);
    expect(injectedTokens(readingProviders, AgentRunExecutor)).not.toContain(LANGUAGE_MODEL_GATEWAY);
    expect(injectedTokens(readingProviders, ReadingConversationService)).toContain(AI_READING_BOOK_ANALYSIS_PORT);
    expect(injectedTokens(readingProviders, ReadingConversationService)).toContain(AI_READING_MODEL_RUNTIME_PORT);
    expect(injectedTokens(modelProviders, ModelConfigService)).toContain(LANGUAGE_MODEL_GATEWAY);
    expect(injectedTokens(analysisProviders, LanguageModelBookClassifierAdapter)).toEqual([LANGUAGE_MODEL_GATEWAY]);
    expect(modelExports).toContain(LANGUAGE_MODEL_GATEWAY);
  });
});

function injectedTokens(providers: Array<Record<string, unknown>>, target: unknown): unknown[] {
  const registration = providers.find((provider) => provider.provide === target);
  return Array.isArray(registration?.inject) ? registration.inject : [];
}

function existingBinding(providers: Array<Record<string, unknown>>, token: unknown): unknown {
  return providers.find((provider) => provider.provide === token)?.useExisting;
}

function productionTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) return [];
    return [path];
  });
}
