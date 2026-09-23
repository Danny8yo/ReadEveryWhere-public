// Position stream: query policy changes do not change the index identity.
export const TOKENIZER_VERSION = "rew-keywords-v4-han-unigram-tech2-boundary1-unicode" + process.versions.unicode;
export const QUERY_POLICY_VERSION = "phrase-or-bm25-v1";
const encode = term => "t" + Array.from(new TextEncoder().encode(term), b => b.toString(16).padStart(2, "0")).join("");
export function tokenizeKeywords(text, _isQuery = false) {
  const out = [];
  const normalized = text.normalize("NFC").toLowerCase();
  const parts = normalized.match(/\p{Script=Han}+|\p{Script=Latin}[\p{Script=Latin}\p{N}]*(?:(?:[:._/\-][\p{Script=Latin}\p{N}]+)|[+#]+[\p{Script=Latin}\p{N}]*)*|(?:(?!\p{Script=Han})[\p{L}\p{N}])+|[^\p{L}\p{N}]+/gu) ?? [];
  for (const part of parts) {
    if (/^\p{Script=Han}+$/u.test(part)) for (const char of part) out.push(encode(char));
    else out.push(encode(part));
  }
  return out;
}
// Each entry is one encoded, ordered phrase, NOT a bag of unique tokens.
// Input whitespace separates complete lexical clauses. No inferred domain terms.
export function prepareKeywordQueries(queries) {
  if (!Array.isArray(queries) || !queries.length || queries.length > 4 ||
      queries.some(q => typeof q !== "string" || !q.trim() || q.length > 128) ||
      queries.reduce((n,q) => n + q.length, 0) > 512)
    throw new Error("QUERY_INVALID: expected 1–4 queries of at most 128 UTF-16 each");
  return [...new Set(queries)].map(query => {
    const clauses = [...new Set(query.normalize("NFC").trim().split(/\s+/u))];
    if (clauses.length > 16 || clauses.some(c => !/[\p{L}\p{N}]/u.test(c)))
      throw new Error("QUERY_INVALID: expected 1–16 non-punctuation lexical clauses");
    return [...new Set(clauses.map(c => tokenizeKeywords(c).join(" ")))];
  });
}
