import type { ScrapedBook } from "../../public";

export type MetadataMatchLevel = "edition" | "work" | "ambiguous" | "conflict";
export type MetadataMatchSignal =
  | "content_derived"
  | "isbn_exact"
  | "title_exact"
  | "title_close"
  | "author_overlap";
export type MetadataMatchConflict = "isbn_mismatch" | "title_mismatch" | "author_mismatch";

export interface MetadataMatchBook {
  title: string;
  authors: readonly string[];
  isbn: string | null;
}

export interface MetadataCandidateMatch {
  level: MetadataMatchLevel;
  signals: MetadataMatchSignal[];
  conflicts: MetadataMatchConflict[];
}

export interface MatchedMetadataCandidate {
  candidate: ScrapedBook;
  match: MetadataCandidateMatch;
}

export function matchMetadataCandidate(
  book: Readonly<MetadataMatchBook>,
  candidate: Readonly<ScrapedBook>,
): MetadataCandidateMatch {
  if (candidate.sourcePlatform === "AI") {
    return { level: "edition", signals: ["content_derived"], conflicts: [] };
  }

  const signals: MetadataMatchSignal[] = [];
  const conflicts: MetadataMatchConflict[] = [];
  const currentIsbn = normalizeIsbn(book.isbn);
  const candidateIsbn = normalizeIsbn(candidate.isbn);
  const isbnExact = Boolean(currentIsbn && candidateIsbn && currentIsbn === candidateIsbn);

  if (isbnExact) signals.push("isbn_exact");
  else if (currentIsbn && candidateIsbn) conflicts.push("isbn_mismatch");

  const titleRelation = compareTitles(book.title, candidate.title);
  if (titleRelation === "exact") signals.push("title_exact");
  else if (titleRelation === "close") signals.push("title_close");
  else conflicts.push("title_mismatch");

  const authorRelation = compareAuthors(book.authors, candidate.authors);
  if (authorRelation === "overlap") signals.push("author_overlap");
  else if (authorRelation === "mismatch") conflicts.push("author_mismatch");

  if (conflicts.includes("isbn_mismatch")) {
    return { level: "conflict", signals, conflicts };
  }
  if (isbnExact && !conflicts.includes("title_mismatch")) {
    return { level: "edition", signals, conflicts };
  }
  if (titleRelation !== "mismatch" && authorRelation === "overlap") {
    return { level: "work", signals, conflicts };
  }
  if (titleRelation !== "mismatch" && authorRelation === "unknown") {
    return { level: "ambiguous", signals, conflicts };
  }
  return { level: "conflict", signals, conflicts };
}

export function matchAndRankMetadataCandidates(
  book: Readonly<MetadataMatchBook>,
  candidates: readonly ScrapedBook[],
): MatchedMetadataCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, match: matchMetadataCandidate(book, candidate), index }))
    .sort((left, right) => matchRank(left.match.level) - matchRank(right.match.level) || left.index - right.index)
    .map(({ candidate, match }) => ({ candidate, match }));
}

function normalizeIsbn(value: string | null): string {
  return value?.normalize("NFKC").toUpperCase().replace(/[^0-9X]/g, "") ?? "";
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

function primaryTitle(value: string): string {
  return normalizeText(value.split(/(?:——|--|：|:|=|（|\(|【|\[)/u, 1)[0] ?? value);
}

function compareTitles(current: string, candidate: string): "exact" | "close" | "mismatch" {
  const currentFull = normalizeText(current);
  const candidateFull = normalizeText(candidate);
  if (!currentFull || !candidateFull) return "mismatch";
  if (currentFull === candidateFull) return "exact";

  const currentPrimary = primaryTitle(current);
  const candidatePrimary = primaryTitle(candidate);
  if (currentPrimary.length >= 2 && currentPrimary === candidatePrimary) return "close";
  if (currentPrimary.length >= 2 && currentPrimary === candidateFull) return "close";
  if (candidatePrimary.length >= 2 && candidatePrimary === currentFull) return "close";
  if (Math.min(currentFull.length, candidateFull.length) >= 4
    && (currentFull.startsWith(candidateFull) || candidateFull.startsWith(currentFull))) return "close";
  return "mismatch";
}

function compareAuthors(
  current: readonly string[],
  candidate: readonly string[],
): "overlap" | "mismatch" | "unknown" {
  const currentAuthors = current.map(normalizeText).filter(Boolean);
  const candidateAuthors = candidate.map(normalizeText).filter(Boolean);
  if (currentAuthors.length === 0 || candidateAuthors.length === 0) return "unknown";

  const overlaps = currentAuthors.some((left) => candidateAuthors.some((right) => (
    left === right || (Math.min(left.length, right.length) >= 2 && (left.includes(right) || right.includes(left)))
  )));
  return overlaps ? "overlap" : "mismatch";
}

function matchRank(level: MetadataMatchLevel): number {
  return { edition: 0, work: 1, ambiguous: 2, conflict: 3 }[level];
}
