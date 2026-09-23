import type { ApplyBookReadingProfileCandidatePort } from "../../../catalog/application/ports/apply-book-reading-profile-candidate.port";
import { BookProfileDomainError } from "../../../catalog/domain/book-reading-profile";
import type { BookAnalysisContentPort } from "../ports/book-analysis-content.port";
import type { BookAnalysisStorePort } from "../ports/book-analysis-store.port";
import { ApplyBookAnalysisCandidateUseCase } from "./apply-book-analysis-candidate.use-case";

const REVISION = {
  fileChecksum: "sha256:book-v1",
  extractorVersion: "epub-extractor-v4",
  normalizationVersion: "epub-text-v1",
};

describe("ApplyBookAnalysisCandidateUseCase", () => {
  it("applies a pending candidate through the Catalog port and consumes it", async () => {
    const store = makeStore(makeCandidate());
    const profiles = makeProfiles();
    const useCase = new ApplyBookAnalysisCandidateUseCase(profiles, content(), store);

    await expect(useCase.execute(7, 42, "candidate-1", false)).resolves.toMatchObject({
      candidateId: "candidate-1",
      applied: true,
      profile: { primaryGenre: "technical", profileVersion: 2 },
    });
    expect(profiles.apply).toHaveBeenCalledWith(
      7,
      42,
      expect.objectContaining({ candidateId: "candidate-1", baseProfileVersion: 1 }),
      REVISION,
      false,
    );
    expect(store.consumeCandidate).toHaveBeenCalledWith("candidate-1", expect.any(Function));
  });

  it("rejects a profile version conflict unless the user explicitly overrides", async () => {
    const store = makeStore(makeCandidate());
    const profiles = makeProfiles();
    profiles.apply
      .mockImplementationOnce(() => {
        throw new BookProfileDomainError("PROFILE_VERSION_CONFLICT", "Profile changed");
      })
      .mockReturnValueOnce(formalProfile());
    const useCase = new ApplyBookAnalysisCandidateUseCase(profiles, content(), store);

    await expect(useCase.execute(7, 42, "candidate-1", false)).rejects.toMatchObject({
      reason: "BOOK_ANALYSIS_PROFILE_VERSION_CONFLICT",
    });
    await expect(useCase.execute(7, 42, "candidate-1", true)).resolves.toMatchObject({ applied: true });
  });

  it.each([
    ["BOOK_ANALYSIS_CANDIDATE_NOT_FOUND", "missing"],
    ["BOOK_ANALYSIS_CANDIDATE_NOT_PENDING", "applied"],
    ["BOOK_ANALYSIS_CANDIDATE_BOOK_MISMATCH", "wrong-book"],
  ])("rejects %s before mutating the Book", async (reason, scenario) => {
    const candidate = scenario === "missing"
      ? null
      : makeCandidate({
        status: scenario === "applied" ? "applied" : "pending",
        bookId: scenario === "wrong-book" ? 99 : 42,
      });
    const store = makeStore(candidate);
    const profiles = makeProfiles();
    const useCase = new ApplyBookAnalysisCandidateUseCase(profiles, content(), store);

    await expect(useCase.execute(7, 42, "candidate-1", false)).rejects.toMatchObject({
      reason,
      ...(scenario === "missing" ? { kind: "NOT_FOUND" } : {}),
    });
    expect(profiles.apply).not.toHaveBeenCalled();
  });

  it("does not report success when the conditional candidate transition loses a race", async () => {
    const store = makeStore(makeCandidate());
    store.consumeCandidate.mockReturnValue({ consumed: false });
    const profiles = makeProfiles();
    const useCase = new ApplyBookAnalysisCandidateUseCase(profiles, content(), store);

    await expect(useCase.execute(7, 42, "candidate-1", false)).rejects.toMatchObject({
      reason: "BOOK_ANALYSIS_CANDIDATE_NOT_PENDING",
    });
  });
});

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    userId: 7,
    bookId: 42,
    baseProfileVersion: 1,
    primaryGenre: "technical" as const,
    secondaryGenres: [],
    traits: ["linear"],
    confidence: 0.9,
    classificationSummary: "A technical structure.",
    contentRevision: REVISION,
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    analyzedAt: "2026-08-27T00:00:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function makeProfiles(): jest.Mocked<ApplyBookReadingProfileCandidatePort> {
  return {
    apply: jest.fn().mockReturnValue(formalProfile()),
  };
}

function makeStore(candidate: ReturnType<typeof makeCandidate> | null): jest.Mocked<Pick<BookAnalysisStorePort, "getCandidate" | "consumeCandidate">> {
  return {
    getCandidate: jest.fn().mockReturnValue(candidate),
    consumeCandidate: jest.fn().mockImplementation((_candidateId, apply) => ({
      consumed: true,
      value: apply(),
    })),
  };
}

function formalProfile() {
  return {
    id: "profile-42",
    primaryGenre: "technical" as const,
    secondaryGenres: [],
    traits: ["linear"],
    confidence: { kind: "ai-score" as const, score: 0.9 },
    classificationSummary: "A technical structure.",
    profileVersion: 2,
    updatedAt: "2026-08-27T00:00:01.000Z",
  };
}

function content(): Pick<BookAnalysisContentPort, "currentRevision"> {
  return { currentRevision: jest.fn().mockResolvedValue(REVISION) };
}
