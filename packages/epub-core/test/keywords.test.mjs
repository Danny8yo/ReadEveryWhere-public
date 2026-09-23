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
