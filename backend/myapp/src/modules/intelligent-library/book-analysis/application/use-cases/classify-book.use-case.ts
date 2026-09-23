import {
  BookClassificationError,
  parseBookClassificationResponse,
  type BookClassification,
  type BookClassificationIssue,
} from "../classification-response";
import type { BookAnalysisContentPort } from "../ports/book-analysis-content.port";
import {
  BOOK_CLASSIFICATION_JSON_SCHEMA,
  type BookClassifierInput,
  type BookClassifierPort,
} from "../ports/book-classifier.port";
import type { BookAnalysisModelConfigPort } from "../ports/book-analysis-model-config.port";
import type { BookAnalysisStorePort } from "../ports/book-analysis-store.port";
import { BookReadingProfileCandidate } from "../../domain/book-reading-profile-candidate";

export interface BookClassificationStrategyOptions {
  strategyVersion: string;
  confidenceThreshold: number;
  maxSchemaRepairAttempts: number;
  maxSampleSections: number;
  maxSampleCharacters: number;
  maxCharactersPerSample: number;
}

export class ClassifyBookUseCase {
  constructor(
    private readonly content: BookAnalysisContentPort,
    private readonly classifier: BookClassifierPort,
    private readonly profiles: Pick<BookAnalysisStorePort, "saveProfile">,
    private readonly modelConfigs: BookAnalysisModelConfigPort,
    private readonly options: BookClassificationStrategyOptions,
    private readonly runtime = {
      now: () => new Date().toISOString(),
      idFactory: () => crypto.randomUUID(),
    },
  ) {}

  async execute(input: { userId: number; bookId: number }): Promise<BookReadingProfileCandidate> {
    const credential = this.modelConfigs.getCredential(input.userId);
    if (!credential) {
      throw new BookClassificationError(
        "CLASSIFICATION_UNAVAILABLE",
        "AI model configuration is missing",
        false,
      );
    }
    const inspection = await this.content.inspect(input.userId, input.bookId);
    const request = {
      ...inspection,
      providerId: credential.provider,
      modelId: credential.modelId,
      apiKey: credential.apiKey,
      responseSchema: BOOK_CLASSIFICATION_JSON_SCHEMA,
    };
    const repairBudget = { used: 0 };
    let classification = await this.classifyValidated(request, repairBudget);

    if (inspection.toc.length === 0
      || classification.confidence < this.options.confidenceThreshold) {
      const samples = await this.content.sampleRepresentativeText({
        userId: input.userId,
        bookId: input.bookId,
        contentRevision: inspection.contentRevision,
        maxSections: this.options.maxSampleSections,
        maxTotalCharacters: this.options.maxSampleCharacters,
        maxCharactersPerSection: this.options.maxCharactersPerSample,
      });
      classification = await this.classifyValidated({ ...request, samples }, repairBudget);
    }

    const profile = BookReadingProfileCandidate.create({
      id: this.runtime.idFactory(),
      userId: input.userId,
      bookId: input.bookId,
      ...classification,
      contentRevision: inspection.contentRevision,
      modelId: credential.modelId,
      strategyVersion: this.options.strategyVersion,
      analyzedAt: this.runtime.now(),
    });
    this.profiles.saveProfile(profile, inspection.baseProfileVersion);
    return profile;
  }

  private async classifyValidated(
    request: BookClassifierInput,
    repairBudget: { used: number },
  ): Promise<BookClassification> {
    let repair: BookClassifierInput["repair"];
    while (true) {
      try {
        const response = await this.classifier.classify({
          ...request,
          ...(repair ? { repair } : {}),
        });
        return parseBookClassificationResponse(response);
      } catch (error) {
        if (!(error instanceof BookClassificationError)
          || error.code !== "CLASSIFICATION_SCHEMA_INVALID"
          || repairBudget.used >= this.options.maxSchemaRepairAttempts) {
          throw error;
        }
        repairBudget.used += 1;
        repair = {
          attempt: repairBudget.used,
          issues: safeRepairIssues(error.issues),
        };
      }
    }
  }
}

function safeRepairIssues(
  issues: readonly BookClassificationIssue[],
): BookClassificationIssue[] {
  const result = issues.slice(0, 10).map((issue) => ({
    path: /^[A-Za-z0-9_$.[\]-]{1,120}$/.test(issue.path) ? issue.path : "$",
    code: /^[a-z0-9_]{1,64}$/i.test(issue.code) ? issue.code : "schema_invalid",
  }));
  return result.length > 0 ? result : [{ path: "$", code: "schema_invalid" }];
}
