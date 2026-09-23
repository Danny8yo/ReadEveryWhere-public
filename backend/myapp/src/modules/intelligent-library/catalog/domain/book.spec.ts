import { Book } from "./book";

describe("Book aggregate", () => {
  const now = "2026-08-26T00:00:00.000Z";

  it("creates a normalized user-owned catalog asset with an initial source reference", () => {
    const book = Book.create({
      ownerId: 7,
      metadata: {
        title: "  Domain   Driven Design  ",
        authors: [" Eric Evans ", "Eric Evans"],
        isbn: " 9780321125217 ",
      },
      sourceReference: {
        platform: " ZLIBRARY ",
        sourceBookId: " book-1 ",
        sourceUrl: " https://example.test/book-1 ",
        hash: " hash-1 ",
      },
      now,
      profileIdFactory: () => "profile-created",
    });

    expect(book.ownerId).toBe(7);
    expect(book.metadata).toMatchObject({
      title: "Domain   Driven Design",
      authors: ["Eric Evans"],
      isbn: "9780321125217",
    });
    expect(book.sourceReferences).toEqual([
      expect.objectContaining({
        platform: "zlibrary",
        sourceBookId: "book-1",
        hash: "hash-1",
      }),
    ]);
    expect(book.version).toBe(1);
    expect(book.readingProfile).toMatchObject({
      id: "profile-created",
      primaryGenre: null,
      profileVersion: 1,
    });
  });

  it("保留历史差异：create 拒绝空作者，edit 允许清空作者", () => {
    expect(() => Book.create({
      ownerId: 1,
      metadata: { title: "Book", authors: [] },
      now,
    })).toThrow("authors must contain at least one non-empty value");

    const book = rehydrate();
    expect(book.editMetadata({ authors: [] })).toBe(true);
    expect(book.metadata.authors).toEqual([]);

  });

  it("保留历史差异：本地导入允许用空作者创建书籍", () => {
    const book = Book.createImported({
      ownerId: 1,
      authorsText: "",
      metadata: { title: "Imported PDF", authors: [] },
      now,
    });
    expect(book.metadata.authors).toEqual([]);
  });

  it("metadata edit overwrites existing values and preserves same-value version semantics", () => {
    const book = rehydrate();

    expect(book.editMetadata({ title: "Original" })).toBe(true);
    expect(book.version).toBe(2);

    expect(book.editMetadata({ title: "Changed", publisher: " Publisher " })).toBe(true);
    expect(book.metadata.title).toBe("Changed");
    expect(book.metadata.publisher).toBe("Publisher");
    expect(book.version).toBe(3);
  });

  it("preserves immutable snapshots and rejects duplicate source identity", () => {
    const book = rehydrate();
    const metadata = book.metadata;
    const sources = book.sourceReferences;
    metadata.authors.push("Mutation");
    sources.push(sources[0]);

    expect(book.metadata.authors).toEqual(["Author"]);
    expect(book.sourceReferences).toHaveLength(1);
    expect(() => book.addSourceReference({
      platform: "manual",
      sourceBookId: "source-1",
      sourceUrl: null,
      hash: null,
    })).toThrow("Source reference already exists");
  });

  it("advances aggregate version and timestamp when a source reference is added", () => {
    const book = rehydrate();
    const updatedAt = "2026-08-26T02:00:00.000Z";

    book.addSourceReference({
      platform: "zlibrary",
      sourceBookId: "source-2",
      sourceUrl: "https://example.test/source-2",
      hash: "hash-2",
    }, updatedAt);

    expect(book.sourceReferences).toHaveLength(2);
    expect(book.version).toBe(2);
    expect(book.updatedAt).toBe(updatedAt);
  });

  it("does not advance aggregate state when a duplicate source is rejected", () => {
    const book = rehydrate();

    expect(() => book.addSourceReference({
      platform: "manual",
      sourceBookId: "source-1",
    }, "2026-08-26T02:00:00.000Z")).toThrow("Source reference already exists");

    expect(book.sourceReferences).toHaveLength(1);
    expect(book.version).toBe(1);
    expect(book.updatedAt).toBe(now);
  });

  it("preserves unedited legacy metadata bytes while normalizing the changed field", () => {
    const book = Book.rehydrate({
      id: 10,
      ownerId: 1,
      metadata: {
        title: "  Legacy   title  ",
        authors: [" Author ", " Author "],
        isbn: null,
      },
      sourceReferences: [],
      readingProfile: {
        id: "profile-10", primaryGenre: null, secondaryGenres: [], traits: [],
        confidence: null, classificationSummary: null, profileVersion: 1, updatedAt: now,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    expect(book.editMetadata({ isbn: " 9780000000001 " }, now)).toBe(true);
    expect(book.metadata).toMatchObject({
      title: "  Legacy   title  ",
      authors: [" Author ", " Author "],
      isbn: "9780000000001",
    });
  });

  it("applies a candidate through the aggregate with optimistic profile version protection", () => {
    const book = rehydrate();
    const candidate = {
      candidateId: "candidate-1",
      bookId: 10,
      baseProfileVersion: 1,
      primaryGenre: "argumentation" as const,
      secondaryGenres: ["popular-science" as const],
      traits: ["claim-driven"],
      confidence: 0.92,
      classificationSummary: "Evidence-led argument.",
      contentRevision: revision("v1"),
      modelId: "deepseek-v4-flash",
      strategyVersion: "book-profile-v1",
      analyzedAt: now,
    };

    expect(book.applyAnalysisCandidate(
      candidate,
      revision("v1"),
      false,
      "2026-08-27T01:00:00.000Z",
    )).toBe(true);
    expect(book.readingProfile).toMatchObject({
      primaryGenre: "argumentation",
      confidence: { kind: "ai-score", score: 0.92 },
      traits: ["claim-driven"],
      profileVersion: 2,
    });
    expect(book.version).toBe(2);

    book.editReadingProfile({ classificationSummary: "My reason." }, "2026-08-27T02:00:00.000Z");
    expect(() => book.applyAnalysisCandidate(candidate, revision("v1"), false, now))
      .toThrow(expect.objectContaining({ code: "PROFILE_VERSION_CONFLICT" }));
    expect(book.applyAnalysisCandidate(candidate, revision("v1"), true, now)).toBe(true);
  });

  it("explicit override still rejects a candidate for another book or content revision", () => {
    const book = rehydrate();
    const candidate = {
      candidateId: "candidate-1",
      bookId: 999,
      baseProfileVersion: 1,
      primaryGenre: "technical" as const,
      secondaryGenres: [],
      traits: [],
      confidence: 0.9,
      classificationSummary: "Technical.",
      contentRevision: revision("v1"),
      modelId: "deepseek-v4-flash",
      strategyVersion: "book-profile-v1",
      analyzedAt: now,
    };

    expect(() => book.applyAnalysisCandidate(candidate, revision("v1"), true, now))
      .toThrow(expect.objectContaining({ code: "PROFILE_CANDIDATE_BOOK_MISMATCH" }));
    expect(() => book.applyAnalysisCandidate({ ...candidate, bookId: 10 }, revision("v2"), true, now))
      .toThrow(expect.objectContaining({ code: "PROFILE_CANDIDATE_REVISION_CHANGED" }));
  });

  it("user edits and clear advance Book version only when the profile really changes", () => {
    const book = rehydrate();

    expect(book.editReadingProfile({
      primaryGenre: "narrative",
      secondaryGenres: [],
      classificationSummary: null,
    }, "2026-08-27T01:00:00.000Z")).toBe(true);
    expect(book.version).toBe(2);
    expect(book.readingProfile.confidence).toEqual({ kind: "user-determined" });

    expect(book.editReadingProfile({ primaryGenre: "narrative" }, now)).toBe(false);
    expect(book.version).toBe(2);
    expect(book.clearReadingProfile("manual", "2026-08-27T02:00:00.000Z")).toBe(true);
    expect(book.version).toBe(3);
    expect(book.readingProfile).toMatchObject({ primaryGenre: null, profileVersion: 3 });
    expect(book.clearReadingProfile("manual", now)).toBe(false);
    expect(book.version).toBe(3);
  });

  it("advances profile and aggregate versions for a content replacement even when already empty", () => {
    const book = rehydrate();

    expect(book.clearReadingProfile("file-replacement", "2026-08-27T03:00:00.000Z")).toBe(true);
    expect(book.readingProfile).toMatchObject({
      primaryGenre: null,
      profileVersion: 2,
      updatedAt: "2026-08-27T03:00:00.000Z",
    });
    expect(book.version).toBe(2);
    expect(book.updatedAt).toBe("2026-08-27T03:00:00.000Z");
  });

  function rehydrate() {
    return Book.rehydrate({
      id: 10,
      ownerId: 1,
      metadata: {
        title: "Original",
        authors: ["Author"],
        isbn: null,
        coverUrl: null,
        description: null,
        publisher: null,
        publishYear: null,
        editionTag: null,
      },
      sourceReferences: [{
        platform: "manual",
        sourceBookId: "source-1",
        sourceUrl: null,
        hash: null,
        availability: "available",
      }],
      version: 1,
      readingProfile: {
        id: "profile-10",
        primaryGenre: null,
        secondaryGenres: [],
        traits: [],
        confidence: null,
        classificationSummary: null,
        profileVersion: 1,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
  }
});

function revision(checksum: string) {
  return {
    fileChecksum: `sha256:${checksum}`,
    extractorVersion: "epub-extractor-v4",
    normalizationVersion: "epub-text-v1",
  };
}
