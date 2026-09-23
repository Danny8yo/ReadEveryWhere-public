// Node-only deployment budgets. Read when starting a job, after application env loading.
export function readEpubMemoryLimits(env = process.env) {
  const integer = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value * 1048576))
      throw new Error(`${name} must be a positive integer in MiB`);
    return value;
  };
  const rssMiB = integer('EPUB_INDEX_RSS_LIMIT_MIB', 1200);
  const indexHeapMiB = integer('EPUB_INDEX_HEAP_LIMIT_MIB', 192);
  const interactiveHeapMiB = integer('EPUB_INTERACTIVE_HEAP_LIMIT_MIB', 384);
  if (indexHeapMiB >= rssMiB || interactiveHeapMiB >= rssMiB)
    throw new Error('EPUB worker heap limits must be below EPUB_INDEX_RSS_LIMIT_MIB');
  return { rssBytes: rssMiB * 1048576, indexHeapMiB, interactiveHeapMiB };
}
