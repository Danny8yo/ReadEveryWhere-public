import { BookAnalysisError } from "../../domain/book-analysis.error";
import { RequestBookAnalysisUseCase } from "./request-book-analysis.use-case";

export class BatchBookAnalysisUseCase {
  constructor(
    private readonly requestBookAnalysis: Pick<RequestBookAnalysisUseCase, "execute">,
    private readonly options: { maxBatchSize: number },
  ) {}

  async execute(userId: number, input: { bookIds: number[]; force: boolean }) {
    const bookIds = [...new Set(input.bookIds)];
    if (bookIds.length === 0 || bookIds.length > this.options.maxBatchSize) {
      throw BookAnalysisError.validation("bookIds", `Batch size must be between 1 and ${this.options.maxBatchSize}`);
    }
    const items = await Promise.all(bookIds.map(async (bookId) => {
      try {
        return await this.requestBookAnalysis.execute(userId, { bookId, force: input.force });
      } catch (error) {
        if (!(error instanceof BookAnalysisError)) throw error;
        return {
          bookId,
          disposition: "rejected" as const,
          status: "not_analyzed" as const,
          taskId: null,
          reason: error.reason ?? "ANALYSIS_REJECTED",
        };
      }
    }));
    return { items };
  }
}
