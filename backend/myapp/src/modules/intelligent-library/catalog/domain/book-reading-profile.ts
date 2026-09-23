export const BOOK_READING_GENRES = [
  "technical",
  "argumentation",
  "narrative",
  "paper",
  "poetry",
  "popular-science",
  "self-help",
  "general",
] as const;

export type BookReadingGenre = (typeof BOOK_READING_GENRES)[number];

export type BookProfileConfidence =
  | { kind: "ai-score"; score: number }
  | { kind: "user-determined" }
  | null;

export interface BookReadingProfileJSON {
  id: string;
  primaryGenre: BookReadingGenre | null;
  secondaryGenres: BookReadingGenre[];
  traits: string[];
  confidence: BookProfileConfidence;
  classificationSummary: string | null;
  profileVersion: number;
  updatedAt: string;
}

export interface EditBookReadingProfile {
  primaryGenre?: BookReadingGenre | null;
  secondaryGenres?: BookReadingGenre[];
  classificationSummary?: string | null;
}

export interface AnalysisProfileValues {
  primaryGenre: BookReadingGenre;
  secondaryGenres: BookReadingGenre[];
  traits: string[];
  confidence: number;
  classificationSummary: string;
}

export class BookProfileDomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "BookProfileDomainError";
  }
}

export class BookReadingProfile {
  private constructor(private value: BookReadingProfileJSON) {}

  static empty(input: { id: string; now: string }): BookReadingProfile {
    return new BookReadingProfile({
      id: requireText(input.id, "PROFILE_ID_INVALID", "Profile id"),
      primaryGenre: null,
      secondaryGenres: [],
      traits: [],
      confidence: null,
      classificationSummary: null,
      profileVersion: 1,
      updatedAt: requireText(input.now, "PROFILE_DATE_INVALID", "Updated at"),
    });
  }

  static rehydrate(input: BookReadingProfileJSON): BookReadingProfile {
    return new BookReadingProfile(normalizeProfile(input));
  }

  get id(): string { return this.value.id; }
  get profileVersion(): number { return this.value.profileVersion; }

  isConfigured(): boolean {
    return this.value.primaryGenre !== null;
  }

  editByUser(change: EditBookReadingProfile, now: string): boolean {
    const hasPrimary = hasOwn(change, "primaryGenre");
    const hasSecondary = hasOwn(change, "secondaryGenres");
    const hasSummary = hasOwn(change, "classificationSummary");
    if (!hasPrimary && !hasSecondary && !hasSummary) return false;

    const primaryGenre = hasPrimary
      ? change.primaryGenre ?? null
      : this.value.primaryGenre;
    const secondaryGenres = hasSecondary
      ? change.secondaryGenres ?? []
      : primaryGenre === null ? [] : this.value.secondaryGenres;
    const next = normalizeProfile({
      ...this.value,
      primaryGenre,
      secondaryGenres,
      confidence: { kind: "user-determined" },
      classificationSummary: hasSummary ? change.classificationSummary ?? null : null,
      profileVersion: this.value.profileVersion,
      updatedAt: this.value.updatedAt,
    });
    return this.replaceIfChanged(next, now);
  }

  applyAnalysis(values: AnalysisProfileValues, now: string): boolean {
    const next = normalizeProfile({
      ...this.value,
      primaryGenre: values.primaryGenre,
      secondaryGenres: values.secondaryGenres,
      traits: values.traits,
      confidence: { kind: "ai-score", score: values.confidence },
      classificationSummary: values.classificationSummary,
      profileVersion: this.value.profileVersion,
      updatedAt: this.value.updatedAt,
    });
    return this.replaceIfChanged(next, now);
  }

  clear(now: string): boolean {
    if (this.value.primaryGenre === null
      && this.value.secondaryGenres.length === 0
      && this.value.traits.length === 0
      && this.value.confidence === null
      && this.value.classificationSummary === null) return false;
    this.value = {
      ...this.value,
      primaryGenre: null,
      secondaryGenres: [],
      traits: [],
      confidence: null,
      classificationSummary: null,
      profileVersion: this.value.profileVersion + 1,
      updatedAt: requireText(now, "PROFILE_DATE_INVALID", "Updated at"),
    };
    return true;
  }

  resetForContentReplacement(now: string): void {
    this.value = {
      ...this.value,
      primaryGenre: null,
      secondaryGenres: [],
      traits: [],
      confidence: null,
      classificationSummary: null,
      profileVersion: this.value.profileVersion + 1,
      updatedAt: requireText(now, "PROFILE_DATE_INVALID", "Updated at"),
    };
  }

  toJSON(): BookReadingProfileJSON {
    return cloneProfile(this.value);
  }

  private replaceIfChanged(next: BookReadingProfileJSON, now: string): boolean {
    if (sameState(this.value, next)) return false;
    this.value = {
      ...next,
      profileVersion: this.value.profileVersion + 1,
      updatedAt: requireText(now, "PROFILE_DATE_INVALID", "Updated at"),
    };
    return true;
  }
}

function normalizeProfile(input: BookReadingProfileJSON): BookReadingProfileJSON {
  const primaryGenre = input.primaryGenre === null ? null : requireGenre(input.primaryGenre);
  const secondaryGenres = unique(input.secondaryGenres.map(requireGenre));
  if (primaryGenre === null && secondaryGenres.length > 0) {
    throw new BookProfileDomainError(
      "PROFILE_PRIMARY_GENRE_REQUIRED",
      "Secondary genres require a primary genre",
    );
  }
  if (primaryGenre !== null && secondaryGenres.includes(primaryGenre)) {
    throw new BookProfileDomainError(
      "PROFILE_GENRE_INVALID",
      "Primary genre cannot also be a secondary genre",
    );
  }
  if (!Number.isInteger(input.profileVersion) || input.profileVersion < 1) {
    throw new BookProfileDomainError("PROFILE_VERSION_INVALID", "Profile version is invalid");
  }
  return {
    id: requireText(input.id, "PROFILE_ID_INVALID", "Profile id"),
    primaryGenre,
    secondaryGenres,
    traits: normalizeTraits(input.traits),
    confidence: normalizeConfidence(input.confidence),
    classificationSummary: normalizeSummary(input.classificationSummary),
    profileVersion: input.profileVersion,
    updatedAt: requireText(input.updatedAt, "PROFILE_DATE_INVALID", "Updated at"),
  };
}

function normalizeTraits(values: string[]): string[] {
  const traits = unique(values.map((value) => value.trim()).filter(Boolean));
  if (traits.length > 20 || traits.some((value) => value.length > 80)) {
    throw new BookProfileDomainError("PROFILE_TRAITS_INVALID", "Profile traits exceed their bounds");
  }
  return traits;
}

function normalizeConfidence(value: BookProfileConfidence): BookProfileConfidence {
  if (value === null) return null;
  if (value.kind === "user-determined") return { kind: "user-determined" };
  if (value.kind === "ai-score" && Number.isFinite(value.score) && value.score >= 0 && value.score <= 1) {
    return { kind: "ai-score", score: value.score };
  }
  throw new BookProfileDomainError(
    "PROFILE_CONFIDENCE_INVALID",
    "AI confidence must be between 0 and 1",
  );
}

function normalizeSummary(value: string | null): string | null {
  if (value === null) return null;
  const summary = value.trim();
  if (!summary) return null;
  if (summary.length > 500) {
    throw new BookProfileDomainError(
      "PROFILE_SUMMARY_INVALID",
      "Classification summary must not exceed 500 characters",
    );
  }
  return summary;
}

function requireGenre(value: unknown): BookReadingGenre {
  if (typeof value !== "string" || !BOOK_READING_GENRES.includes(value as BookReadingGenre)) {
    throw new BookProfileDomainError("PROFILE_GENRE_INVALID", "Unsupported book reading genre");
  }
  return value as BookReadingGenre;
}

function requireText(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BookProfileDomainError(code, `${label} is required`);
  }
  return value.trim();
}

function sameState(left: BookReadingProfileJSON, right: BookReadingProfileJSON): boolean {
  return left.primaryGenre === right.primaryGenre
    && sameArray(left.secondaryGenres, right.secondaryGenres)
    && sameArray(left.traits, right.traits)
    && sameConfidence(left.confidence, right.confidence)
    && left.classificationSummary === right.classificationSummary;
}

function sameConfidence(left: BookProfileConfidence, right: BookProfileConfidence): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === right.kind
    && (left.kind !== "ai-score" || right.kind !== "ai-score" || left.score === right.score);
}

function cloneProfile(value: BookReadingProfileJSON): BookReadingProfileJSON {
  return {
    ...value,
    secondaryGenres: [...value.secondaryGenres],
    traits: [...value.traits],
    confidence: value.confidence === null ? null : { ...value.confidence },
  };
}

function sameArray<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
