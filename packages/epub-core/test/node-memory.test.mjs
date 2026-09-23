import test from 'node:test';
import assert from 'node:assert/strict';
import { readEpubMemoryLimits } from '../src/node-memory.js';
test('standalone defaults and explicitly supplied memory budgets', () => {
  assert.deepEqual(readEpubMemoryLimits({}), { rssBytes: 1200 * 1048576, indexHeapMiB: 192, interactiveHeapMiB: 384 });
  assert.deepEqual(readEpubMemoryLimits({ EPUB_INDEX_RSS_LIMIT_MIB: '1200', EPUB_INDEX_HEAP_LIMIT_MIB: '256', EPUB_INTERACTIVE_HEAP_LIMIT_MIB: '512' }), { rssBytes: 1200 * 1048576, indexHeapMiB: 256, interactiveHeapMiB: 512 });
});
test('invalid memory configuration fails rather than falling back', () => {
  for (const value of ['', '0', '-1', '1.5', '800m', 'NaN', '99999999999999999'])
    assert.throws(() => readEpubMemoryLimits({ EPUB_INDEX_RSS_LIMIT_MIB: value }), /positive integer/);
  assert.throws(() => readEpubMemoryLimits({ EPUB_INDEX_HEAP_LIMIT_MIB: '1200' }), /below/);
});
