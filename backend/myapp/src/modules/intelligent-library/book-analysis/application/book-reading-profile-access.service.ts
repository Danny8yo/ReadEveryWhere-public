import { extname } from "node:path";
import type {
  BookReadingProfileAccessPort,
  BookReadingProfileAccessResult,
} from "../../public/book-reading-profile-access.port";
import type { BookAnalysisContentPort } from "./ports/book-analysis-content.port";
import type { BookAnalysisLibraryPort } from "./ports/book-analysis-library.port";
import type { BookAnalysisStorePort } from "./ports/book-analysis-store.port";

type FormalProfileReader = {
  getCurrentProfile(
    userId: number,
    bookId: number,
  ): Pick<BookReadingProfileAccessResult, "status" | "profile">;
};

export class BookReadingProfileAccessService implements BookReadingProfileAccessPort {
  constructor(
    private readonly formalProfiles: FormalProfileReader,
    private readonly books: Pick<BookAnalysisLibraryPort, "findOwnedAnalysisSource">,
    private readonly content: Pick<BookAnalysisContentPort, "currentRevision">,
    private readonly store: Pick<BookAnalysisStorePort, "getSnapshot">,
    private readonly strategyVersion: string,
  ) {}

  async getCurrentProfile(userId: number, bookId: number): Promise<BookReadingProfileAccessResult> {
    const formal = this.formalProfiles.getCurrentProfile(userId, bookId);
    if (formal.status === "ready") {
      if (!formal.profile) {
        throw new Error("Formal reading profile status is ready but profile is missing");
      }
      return { ...formal, stale: false, errorCode: null };
    }

    const source = this.books.findOwnedAnalysisSource(userId, bookId);
    if (!source?.fileName || source.downloadStatus && source.downloadStatus !== "completed") {
      return emptyAccess("not_analyzed");
    }
    if (source.mimeType !== "application/epub+zip"
      && extname(source.fileName).toLowerCase() !== ".epub") {
      return emptyAccess("unsupported");
    }

    const revision = await this.content.currentRevision(userId, bookId);
    const snapshot = this.store.getSnapshot(userId, bookId, revision, this.strategyVersion);
    return {
      status: snapshot.status,
      stale: snapshot.stale,
      profile: null,
      errorCode: snapshot.errorCode,
    };
  }
}

function emptyAccess(status: "not_analyzed" | "unsupported"): BookReadingProfileAccessResult {
  return { status, stale: false, profile: null, errorCode: null };
}
