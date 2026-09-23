import type { BookReadingProfileAccessPort } from "../../intelligent-library/public";
import type { BookAnalysisPort } from "../application/ports/book-analysis.port";

export class IntelligentLibraryBookAnalysisAdapter implements BookAnalysisPort {
  constructor(private readonly analysis: BookReadingProfileAccessPort) {}

  async getAccess(userId: number, bookId: number) {
    const result = await this.analysis.getCurrentProfile(userId, bookId);
    return {
      status: result.status,
      stale: result.stale,
      errorCode: result.errorCode,
      profile: result.profile ? {
        ...result.profile,
        secondaryGenres: [...result.profile.secondaryGenres],
        traits: [...result.profile.traits],
        confidence: { ...result.profile.confidence },
      } : null,
    };
  }
}
