import type {
  ApplyBookReadingProfileCandidatePort,
} from "../../../catalog/application/ports/apply-book-reading-profile-candidate.port";
import { BookProfileDomainError } from "../../../catalog/domain/book-reading-profile";
import { CatalogError } from "../../../catalog/domain/catalog.error";
import { BookAnalysisError } from "../../domain/book-analysis.error";
import type { BookAnalysisContentPort } from "../ports/book-analysis-content.port";
import type { BookAnalysisStorePort } from "../ports/book-analysis-store.port";

export class ApplyBookAnalysisCandidateUseCase {
  constructor(
    private readonly profiles: ApplyBookReadingProfileCandidatePort,
    private readonly content: Pick<BookAnalysisContentPort, "currentRevision">,
    private readonly store: Pick<BookAnalysisStorePort, "getCandidate" | "consumeCandidate">,
  ) {}

  async execute(userId: number, bookId: number, candidateId: string, override: boolean) {
    const candidate = this.store.getCandidate(userId, candidateId);
    if (!candidate) throw rejected("CANDIDATE_NOT_FOUND", "Analysis candidate not found");
    if (candidate.status !== "pending") {
      throw rejected("CANDIDATE_NOT_PENDING", "Analysis candidate is no longer pending");
    }
    if (candidate.bookId !== bookId) {
      throw rejected("CANDIDATE_BOOK_MISMATCH", "Analysis candidate does not belong to this book");
    }
    const revision = await this.content.currentRevision(userId, candidate.bookId);
    try {
      const consumed = this.store.consumeCandidate(candidateId, () => this.profiles.apply(
        userId,
        bookId,
        {
          candidateId,
          bookId: candidate.bookId,
          baseProfileVersion: candidate.baseProfileVersion,
          primaryGenre: candidate.primaryGenre,
          secondaryGenres: candidate.secondaryGenres,
          traits: candidate.traits,
          confidence: candidate.confidence,
          classificationSummary: candidate.classificationSummary,
          contentRevision: { ...candidate.contentRevision },
          modelId: candidate.modelId,
          strategyVersion: candidate.strategyVersion,
          analyzedAt: candidate.analyzedAt,
        },
        revision,
        override,
      ));
      if (!consumed.consumed) {
        throw rejected("CANDIDATE_NOT_PENDING", "Analysis candidate is no longer pending");
      }
      return {
        candidateId,
        bookId: candidate.bookId,
        applied: true,
        profile: consumed.value,
      };
    } catch (error) {
      if (error instanceof BookProfileDomainError) {
        throw BookAnalysisError.rejected(domainReason(error.code), error.message);
      }
      if (error instanceof CatalogError) {
        throw BookAnalysisError.rejected(
          error.kind === "NOT_FOUND" ? "BOOK_NOT_FOUND" : "BOOK_CHANGED",
          error.message,
        );
      }
      throw error;
    }
  }
}

function rejected(reason: string, message: string): BookAnalysisError {
  return BookAnalysisError.rejected(`BOOK_ANALYSIS_${reason}`, message);
}

function domainReason(code: string): string {
  return code.startsWith("PROFILE_") ? `BOOK_ANALYSIS_${code}` : code;
}
