import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeKeywords, prepareKeywordQueries, TOKENIZER_VERSION } from "../src/keywords.js";
const decode = text => tokenizeKeywords(text).map(t => Buffer.from(t.slice(1), "hex").toString());
test("position stream preserves every Han codepoint, repetition, stop characters and boundaries", () => {
  assert.deepEqual(decode("临时表"), ["临","时","表"]);
  assert.deepEqual(decode("锁的作用"), ["锁","的","作","用"]);
  assert.deepEqual(decode("哈哈哈"), ["哈","哈","哈"]);
  assert.deepEqual(decode("𠮷临，时表"), ["𠮷","临","，","时","表"]);
  assert.deepEqual(decode("αβ锁"), ["αβ","锁"]);
  assert.deepEqual(decode("随机I/O"), ["随","机","i/o"]);
  assert.notDeepEqual(tokenizeKeywords("临时 时表"),tokenizeKeywords("临时表"));
  assert.ok(TOKENIZER_VERSION.includes("han-unigram"));
});
test("technical atoms and normalization do not depend on a domain dictionary", () => {
  for(const term of ["I/O","C++","C#","C++17","Node.js","UTF-8","TCP/IP","node:sqlite"])
    assert.deepEqual(decode(term),[term.toLowerCase()]);
  assert.notDeepEqual(tokenizeKeywords("I/O"),tokenizeKeywords("I O"));
  assert.notDeepEqual(tokenizeKeywords("C++"),tokenizeKeywords("C++17"));
  assert.deepEqual(tokenizeKeywords("cafe\u0301"),tokenizeKeywords("café"));
});
test("query normalization deduplicates whole phrases, never internal positions", () => {
  assert.deepEqual(prepareKeywordQueries(["临时表 磁盘 临时表"]), [[tokenizeKeywords("临时表").join(" "),tokenizeKeywords("磁盘").join(" ")]]);
  assert.deepEqual(prepareKeywordQueries(["哈哈哈"]),[[tokenizeKeywords("哈哈哈").join(" ")]]);
  assert.equal(prepareKeywordQueries(["的"])[0].length,1);
  assert.equal(prepareKeywordQueries(["SQL","SQL"]).length,1);
});
test("phrase query limits reject instead of silently truncating", () => {
  for(const q of [[],[""],["!!!"],["x".repeat(129)],["a","b","c","d","e"],[Array.from({length:17},(_,i)=>"x"+i).join(" ")]])
    assert.throws(()=>prepareKeywordQueries(q));
  assert.doesNotThrow(()=>prepareKeywordQueries(["汉".repeat(128)]));
});
import { tokenizeBigrams, tokenizeWords, planDualQueries, DUAL_TOKENIZER_VERSION, DUAL_QUERY_POLICY_VERSION, DUAL_LIST_WEIGHTS } from "../src/keywords.js";
const text = tokens => tokens.map(t => Buffer.from(t.slice(1), "hex").toString());
test("A1/A2 bigram stream slides inside Han runs and never across separators", () => {
  assert.deepEqual(text(tokenizeBigrams("使用了临时表")), ["使用","用了","了临","临时","时表"]);
  assert.deepEqual(text(tokenizeBigrams("临时，时表")), ["临时","，","时表"]);
  assert.ok(tokenizeBigrams("使用了临时表").every(t => t.startsWith("b")));
  assert.ok(!text(tokenizeBigrams("临时，时表")).some(t => t.includes("，") && t.length > 1));
});
test("A3 technical atoms stay whole in bigram and word streams", () => {
  for (const term of ["I/O","C++","C#","C++17","Node.js","UTF-8"]) {
    assert.deepEqual(text(tokenizeBigrams(term)), [term.toLowerCase()]);
    assert.deepEqual(text(tokenizeWords(term, "index")), [term.toLowerCase()]);
  }
  assert.notDeepEqual(tokenizeBigrams("C++"), tokenizeBigrams("C++17"));
});
test("A4 single Han runs become one bigram-stream token; the char stream is the unchanged v4 stream", () => {
  assert.deepEqual(text(tokenizeBigrams("锁。")), ["锁","。"]);
  assert.deepEqual(text(tokenizeKeywords("锁。")), ["锁","。"]);
  assert.ok(tokenizeKeywords("锁").every(t => t.startsWith("t")));
});
test("A5 normalization: NFD/NFC and case give identical streams", () => {
  for (const tokenize of [tokenizeBigrams, s => tokenizeWords(s, "index")]) {
    assert.deepEqual(tokenize("café"), tokenize("café"));
    assert.deepEqual(tokenize("UTF-8"), tokenize("utf-8"));
    assert.deepEqual(text(tokenizeBigrams("𠮷临")), ["𠮷临"]);
  }
});
test("A6 word and bigram streams are deterministic across calls", () => {
  const sample = "课题分离并不意味着漠不关心，InnoDB遇到死锁时会回滚。";
  assert.deepEqual(tokenizeWords(sample, "index"), tokenizeWords(sample, "index"));
  assert.deepEqual(tokenizeBigrams(sample), tokenizeBigrams(sample));
});
test("A7 dual identity names every component and keeps v4 as the char stream", () => {
  assert.match(DUAL_TOKENIZER_VERSION, /^rew-dual-v1:word=@node-rs\/jieba@2\.0\.3\+dict[0-9a-f]{12}\+hmm0\+search:bigram=b1:char=/);
  assert.ok(DUAL_TOKENIZER_VERSION.endsWith(TOKENIZER_VERSION));
  assert.match(DUAL_QUERY_POLICY_VERSION, /^dual-rrf-v1-stop[0-9a-f]{12}$/);
});
test("A8 repeated characters keep repeated bigram positions", () => {
  assert.deepEqual(text(tokenizeBigrams("哈哈哈")), ["哈哈","哈哈"]);
});
test("word index mode is search mode with sub-words; query mode drops stopwords", () => {
  assert.ok(text(tokenizeWords("使用了临时表", "index")).includes("临时"));
  assert.ok(!text(tokenizeWords("什么情况下会使用临时表", "query")).some(w => ["什么","会"].includes(w)));
  assert.throws(() => tokenizeWords("x", "other"));
});
const plan = (queries, need) => planDualQueries(queries, need).lists.map(l => ({ ...l, words: l.phrases.map(p => p.split(" ").map(t => text([t])[0]).join("")) }));
test("B1/B5 long clauses get a soft bigram bag requiring 60% (at least 2) matches", () => {
  const soft = plan(["创建临时表花费多少时间"]).filter(l => l.kind === "bigram_soft");
  assert.equal(soft.length, 1);
  assert.deepEqual(soft[0].minimum, { ratio: 0.6, floor: 2 });
  assert.ok(soft[0].words.includes("临时") && soft[0].words.includes("时间"));
  assert.equal(soft[0].weight, DUAL_LIST_WEIGHTS.bigram_soft);
  assert.equal(plan(["临时表"]).filter(l => l.kind === "bigram_soft").length, 0);
});
test("B2 exact bigram phrase is built from the whole clause", () => {
  const exact = plan(["临时表 磁盘"]).find(l => l.kind === "bigram_phrase");
  assert.deepEqual(exact.words, ["临时时表", "磁盘"]);
  assert.equal(exact.table, "bigram");
});
test("B3 a single Han clause uses only the char fallback, not a bigram phrase", () => {
  const lists = plan(["锁"]);
  assert.deepEqual(lists.find(l => l.kind === "char").phrases, [tokenizeKeywords("锁").join(" ")]);
  assert.equal(lists.find(l => l.kind === "bigram_phrase"), undefined);
});
test("B4 stopword-only queries produce no word list while other lists remain", () => {
  const lists = plan(["这些 那些"]);
  assert.equal(lists.find(l => l.kind === "word_query"), undefined);
  assert.ok(lists.find(l => l.kind === "bigram_phrase"));
});
test("B6 informationNeed is validated, never truncated; absence skips the need list", () => {
  assert.throws(() => planDualQueries(["临时表"], ""));
  assert.throws(() => planDualQueries(["临时表"], "x".repeat(201)));
  assert.equal(plan(["临时表"]).find(l => l.kind === "word_need"), undefined);
  assert.equal(plan(["临时表"], "临时表的用途").find(l => l.kind === "word_need").weight, DUAL_LIST_WEIGHTS.word_need);
  assert.throws(() => planDualQueries(["a","b","c","d","e"], "x"));
});
test("B7 the plan is deterministic", () => {
  assert.deepEqual(planDualQueries(["创建临时表花费多少时间 锁", "执行阶段"], "观察耗时"), planDualQueries(["创建临时表花费多少时间 锁", "执行阶段"], "观察耗时"));
});
