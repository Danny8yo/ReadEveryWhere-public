export const TOKENIZER_VERSION: string;
export const QUERY_POLICY_VERSION: string;
export function tokenizeKeywords(text: string, isQuery?: boolean): string[];
/** Each inner string is an encoded ordered phrase; whitespace-separated clauses are not individual character tokens. */
export function prepareKeywordQueries(queries: string[]): string[][];
