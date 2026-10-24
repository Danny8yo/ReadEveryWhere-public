import { prepareKeywordQueries } from "@readeverywhere/epub-core/keywords";
import { SelectionQaError } from "./selection-qa.types";
export const QA_QUERY_POLICY_VERSION = "selection-qa-fixed-slots-v4";
/** Search delivery budgets. Reranked pages are small; the fallback keeps the pre-reranking 20/12000 delivery. */
export const QA_SEARCH = Object.freeze({
  poolLimit: 30,
  topK: 6,
  rerankedMaxChars: 6000,
  expandMaxChars: 8000,
  expandWindowChars: 1600,
  fallbackLimit: 20,
  fallbackMaxChars: 12000,
  rerankTimeoutMs: 3000,
  rerankQueryMaxChars: 1000,
});
/** The reranker sees the model's information need first, then the user's question, within a fixed length. */
export function rerankQuery(informationNeed: string, question: string): { text: string; truncated: boolean } {
  const chars = Array.from(`${informationNeed.trim()}\n${question.trim()}`);
  return chars.length > QA_SEARCH.rerankQueryMaxChars
    ? { text: chars.slice(0, QA_SEARCH.rerankQueryMaxChars).join(""), truncated: true }
    : { text: chars.join(""), truncated: false };
}
export type QueryValidation = { field: string; constraint: string; actual?: number; minimum?: number; maximum?: number };
export class QueryArgumentError extends SelectionQaError {
  constructor(public readonly validation: QueryValidation, public readonly validations: QueryValidation[] = [validation]) {
    super("TOOL_ARGUMENTS_INVALID");
  }
}
function invalid(field: string, constraint: string, actual?: number, minimum?: number, maximum?: number): never {
  throw new QueryArgumentError({ field, constraint, ...(actual === undefined ? {} : { actual }), ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) });
}
/** Validate without truncating model queries or hiding unexpected core errors. */
export function validateQueries(value: unknown): string[] {
  if (!Array.isArray(value)) invalid("queries", "array");
  if (value.length < 1 || value.length > 4) invalid("queries", "itemCount", value.length, 1, 4);
  const queries = value.map((q, i) => {
    const field = `queries[${i}]`;
    if (typeof q !== "string") invalid(field, "string");
    if (q.length > 128) invalid(field, "length", q.length, 1, 128);
    const normalized = q.normalize("NFC").replace(/\s+/gu, " ").trim();
    if (!normalized || normalized.length > 128) invalid(field, "length", normalized.length, 1, 128);
    const clauses = [...new Set(normalized.split(" "))];
    if (clauses.length > 16) invalid(field, "clauseCount", clauses.length, 1, 16);
    const punctuation = clauses.findIndex(c => !/[\p{L}\p{N}]/u.test(c));
    if (punctuation !== -1) invalid(`${field}.clauses[${punctuation}]`, "containsLetterOrNumber");
    return normalized;
  });
  prepareKeywordQueries(queries);
  return [...new Set(queries)];
}
export function validateSearchArguments(raw: Record<string, unknown>): string[] {
  const issues: QueryValidation[] = [];
  if (typeof raw.informationNeed !== "string") issues.push({ field: "informationNeed", constraint: "string" });
  else if (!raw.informationNeed.trim() || raw.informationNeed.length > 200)
    issues.push({ field: "informationNeed", constraint: "length", actual: raw.informationNeed.trim() ? raw.informationNeed.length : 0, minimum: 1, maximum: 200 });
  const queries: string[] = [];
  const slots = raw.queries;
  const names = ["query1", "query2", "query3", "query4"];
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) issues.push({ field: "queries", constraint: "fourSlotObject" });
  else {
    const keys = Object.keys(slots);
    if (keys.length !== 4 || keys.some(key => !names.includes(key))) issues.push({ field: "queries", constraint: "exactlyQuery1ToQuery4", actual: keys.length, minimum: 4, maximum: 4 });
    for (const name of names) {
      const value = (slots as Record<string, unknown>)[name];
      if (name !== "query1" && value === "") continue;
      try { queries.push(...validateQueries([value])); } catch (error) {
        if (!(error instanceof QueryArgumentError)) throw error;
        issues.push(...error.validations.map(issue => ({ ...issue, field: issue.field.replace("queries[0]", `queries.${name}`) })));
      }
    }
  }
  if (issues.length) throw new QueryArgumentError(issues[0], issues);
  return [...new Set(queries)];
}
export function stripHistoricalCitations(text: string): string {
  return text.replace(
    /\[\[evidence:[^\]]*(?:\]\]|$)/gu,
    "",
  );
}
