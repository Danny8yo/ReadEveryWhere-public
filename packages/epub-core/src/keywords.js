import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// Position stream: query policy changes do not change the index identity.
export const TOKENIZER_VERSION = "rew-keywords-v4-han-unigram-tech2-boundary1-unicode" + process.versions.unicode;
export const QUERY_POLICY_VERSION = "phrase-or-bm25-v1";
const encode = (term, prefix = "t") => prefix + Array.from(new TextEncoder().encode(term), b => b.toString(16).padStart(2, "0")).join("");
// One lexical segmentation shared by every stream: Han runs, technical atoms, other letters/numbers, separators.
const SEGMENTS = /\p{Script=Han}+|\p{Script=Latin}[\p{Script=Latin}\p{N}]*(?:(?:[:._/\-][\p{Script=Latin}\p{N}]+)|[+#]+[\p{Script=Latin}\p{N}]*)*|(?:(?!\p{Script=Han})[\p{L}\p{N}])+|[^\p{L}\p{N}]+/gu;
const HAN = /^\p{Script=Han}+$/u;
const LEXICAL = /[\p{L}\p{N}]/u;
const segments = text => text.normalize("NFC").toLowerCase().match(SEGMENTS) ?? [];
export function tokenizeKeywords(text, _isQuery = false) {
  const out = [];
  for (const part of segments(text)) {
    if (HAN.test(part)) for (const char of part) out.push(encode(char));
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

// ── Dual-recall streams (word + bigram), used only by the dual-v1 pipeline ──
// The dictionary hash is pinned: a different installed dictionary must not silently share an index identity.
const JIEBA_PACKAGE = "@node-rs/jieba@2.0.3";
const JIEBA_DICT_SHA256 = "139519822fe8ab9e10d9d07e68ea0451045380aedaf54ecc51e2a28c6b42a13f";
/** Query-only function words. Changing the list changes the query policy, never the index identity. */
export const WORD_STOPWORDS = Object.freeze([
  "的", "了", "着", "过", "和", "与", "及", "或", "而", "且", "并", "也", "都", "就", "又", "还", "再",
  "是", "在", "有", "为", "以", "于", "从", "到", "对", "把", "被", "让", "给", "向", "由", "之", "其",
  "这", "那", "这个", "那个", "这些", "那些", "这种", "一个", "一种", "一些", "我", "你", "他", "她", "它",
  "我们", "你们", "他们", "什么", "怎么", "怎样", "如何", "为什么", "哪些", "哪个", "是否", "是不是",
  "吗", "呢", "吧", "啊", "呀", "么", "可以", "能", "能够", "会", "要", "应该", "需要", "请", "请问",
  "关于", "有关", "以及", "如果", "因为", "所以", "但是", "然后", "中", "上", "下", "里", "等", "个",
  "书中", "本书", "这本书", "作者", "一下", "解释", "说明", "介绍", "具体", "主要",
]);
const STOPWORDS = new Set(WORD_STOPWORDS);
const STOPWORDS_HASH = createHash("sha256").update(WORD_STOPWORDS.join("\n")).digest("hex").slice(0, 12);
export const DUAL_TOKENIZER_VERSION =
  `rew-dual-v1:word=${JIEBA_PACKAGE}+dict${JIEBA_DICT_SHA256.slice(0, 12)}+hmm0+search:bigram=b1:char=${TOKENIZER_VERSION}`;
export const DUAL_QUERY_POLICY_VERSION = `dual-rrf-v1-stop${STOPWORDS_HASH}`;
/** Fusion weights per recall list kind; fixed before tuning and versioned with the query policy. */
export const DUAL_LIST_WEIGHTS = Object.freeze({ word_query: 1, word_need: 0.5, bigram_phrase: 1, bigram_soft: 0.6, char: 1 });
export const DUAL_MAX_LIST_TERMS = 24;
const MAX_SOFT_LISTS = 8;
let jieba;
// Loaded lazily: replay/context workers import this module but never pay for the dictionary.
function segmenter() {
  if (jieba) return jieba;
  const require = createRequire(import.meta.url);
  const { Jieba } = require("@node-rs/jieba");
  const { dict } = require("@node-rs/jieba/dict");
  const actual = createHash("sha256").update(dict).digest("hex");
  if (actual !== JIEBA_DICT_SHA256)
    throw new Error(`TOKENIZER_MISMATCH: jieba dictionary ${actual} differs from pinned ${JIEBA_DICT_SHA256}`);
  jieba = Jieba.withDict(dict);
  return jieba;
}
/** Loads and verifies the jieba dictionary now (synchronous, ~0.05–0.3 s); later calls reuse it. */
export function prepareWordSegmenter() {
  segmenter();
}
/** Overlapping Han bigrams; separators keep their own positions so no bigram crosses them. */
export function tokenizeBigrams(text) {
  const out = [];
  for (const part of segments(text)) {
    if (!HAN.test(part)) { out.push(encode(part, "b")); continue; }
    const chars = Array.from(part);
    if (chars.length === 1) out.push(encode(chars[0], "b"));
    for (let i = 0; i + 1 < chars.length; i++) out.push(encode(chars[i] + chars[i + 1], "b"));
  }
  return out;
}
/**
 * Bag of words. Indexing uses jieba search mode (coarse and fine words), queries use exact mode
 * without stopwords. Technical atoms bypass jieba; separators carry no word.
 */
export function tokenizeWords(text, mode) {
  if (mode !== "index" && mode !== "query") throw new TypeError("Word tokenization mode must be index or query");
  const out = [];
  for (const part of segments(text)) {
    if (HAN.test(part)) {
      const words = mode === "index" ? segmenter().cutForSearch(part, false) : segmenter().cut(part, false);
      for (const word of words) if (mode === "index" || !STOPWORDS.has(word)) out.push(encode(word, "w"));
    } else if (LEXICAL.test(part)) out.push(encode(part, "w"));
  }
  return out;
}
const hanLength = clause => Array.from(clause.normalize("NFC")).filter(c => HAN.test(c)).length;
const unique = values => [...new Set(values)];
/**
 * Deterministic recall plan. Every list is an OR over encoded phrases with its own minimum match;
 * the repository caps over-long single-token lists by document frequency.
 */
export function planDualQueries(queries, informationNeed) {
  prepareKeywordQueries(queries);
  if (informationNeed !== undefined && (typeof informationNeed !== "string" || !informationNeed.trim() || informationNeed.length > 200))
    throw new Error("QUERY_INVALID: informationNeed must be 1–200 UTF-16 when provided");
  const lists = [];
  const push = list => { if (list.phrases.length) lists.push({ ...list, weight: DUAL_LIST_WEIGHTS[list.kind] }); };
  let softLists = 0;
  for (const query of unique(queries)) {
    const clauses = unique(query.normalize("NFC").trim().split(/\s+/u));
    const singles = clauses.filter(c => HAN.test(c) && Array.from(c).length === 1);
    const others = clauses.filter(c => !singles.includes(c));
    push({ kind: "char", table: "char", query, phrases: unique(singles.map(c => tokenizeKeywords(c).join(" "))), minimum: 1 });
    push({ kind: "bigram_phrase", table: "bigram", query, phrases: unique(others.map(c => tokenizeBigrams(c).join(" "))), minimum: 1 });
    for (const clause of others) {
      if (hanLength(clause) < 4 || softLists >= MAX_SOFT_LISTS) continue;
      // Only Han bigrams carry fuzzy evidence; separators and atoms stay in the exact phrase list.
      const grams = unique(tokenizeBigrams(clause).filter(t => HAN.test(Buffer.from(t.slice(1), "hex").toString())));
      if (grams.length < 3) continue;
      softLists++;
      push({ kind: "bigram_soft", table: "bigram", query, clause, phrases: grams, minimum: { ratio: 0.6, floor: 2 } });
    }
    push({ kind: "word_query", table: "word", query, phrases: unique(clauses.flatMap(c => tokenizeWords(c, "query"))), minimum: 1 });
  }
  if (informationNeed !== undefined)
    push({ kind: "word_need", table: "word", query: informationNeed, phrases: unique(tokenizeWords(informationNeed, "query")), minimum: 1 });
  return { version: DUAL_QUERY_POLICY_VERSION, lists };
}
