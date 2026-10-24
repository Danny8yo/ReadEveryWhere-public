export const TOKENIZER_VERSION: string;
export const QUERY_POLICY_VERSION: string;
export function tokenizeKeywords(text: string, isQuery?: boolean): string[];
/** Each inner string is an encoded ordered phrase; whitespace-separated clauses are not individual character tokens. */
export function prepareKeywordQueries(queries: string[]): string[][];
export const WORD_STOPWORDS: readonly string[];
export const DUAL_TOKENIZER_VERSION: string;
export const DUAL_QUERY_POLICY_VERSION: string;
export const DUAL_LIST_WEIGHTS: Readonly<Record<DualListKind, number>>;
export const DUAL_MAX_LIST_TERMS: number;
export type DualListKind = "word_query" | "word_need" | "bigram_phrase" | "bigram_soft" | "char";
export type DualTable = "word" | "bigram" | "char";
export interface DualRecallList {
  kind: DualListKind;
  table: DualTable;
  /** The model query (or information need) this list was derived from. */
  query: string;
  /** Present for bigram_soft: the clause whose bigram bag is matched. */
  clause?: string;
  /** Encoded phrases; single-token entries for word/bigram_soft lists. */
  phrases: string[];
  /** 1 = OR; ratio = at least max(floor, ceil(ratio × considered terms)). */
  minimum: 1 | { ratio: number; floor: number };
  weight: number;
}
export function prepareWordSegmenter(): void;
export function tokenizeBigrams(text: string): string[];
export function tokenizeWords(text: string, mode: "index" | "query"): string[];
export function planDualQueries(queries: string[], informationNeed?: string): { version: string; lists: DualRecallList[] };
