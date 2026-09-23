import { Worker } from "node:worker_threads";
import { readEpubMemoryLimits } from "./node-memory.js";
const lanes = {
  interactive: { active: false, queue: [], maxQueued: 8 },
  index: { active: false, queue: [], maxQueued: 2 },
};
function pump(lane) {
  if (lane.active || !lane.queue.length) return;
  const job = lane.queue.shift();
  lane.active = true;
  job.started = true;
  runWorker(job)
    .then(job.resolve, job.reject)
    .finally(() => {
      lane.active = false;
      pump(lane);
    });
}
function submit(
  bytes,
  selection,
  { timeoutMs = 30_000, signal, onBatch } = {},
) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("EPUB input must be Uint8Array or Buffer");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid EPUB worker timeout");
  if (signal?.aborted)
    return Promise.reject(
      signal.reason ?? new Error("EPUB extraction aborted"),
    );
  if (selection?.action === "index" && bytes.byteLength > 64 * 1024 * 1024)
    throw Object.assign(
      new Error(
        "INDEX_RESOURCE_LIMIT: compressed EPUB exceeds indexing budget (64 MiB)",
      ),
      { code: "INDEX_RESOURCE_LIMIT" },
    );
  const lane = selection?.action === "index" ? lanes.index : lanes.interactive;
  if (lane.queue.length >= lane.maxQueued)
    return Promise.reject(new Error("EPUB extraction queue is full"));
  return new Promise((resolve, reject) => {
    const job = {
      bytes,
      selection,
      deadline: Date.now() + timeoutMs,
      signal,
      onBatch,
      started: false,
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    };
    job.resolve = (value) => {
      cleanup();
      resolve(value);
    };
    job.reject = (error) => {
      cleanup();
      reject(error);
    };
    const cancel = () => {
      const error = signal?.aborted
        ? (signal.reason ?? new Error("EPUB extraction aborted"))
        : new Error("EPUB extraction deadline exceeded");
      if (job.started) job.cancel(error);
      else {
        lane.queue.splice(lane.queue.indexOf(job), 1);
        job.reject(error);
      }
    };
    const timer = setTimeout(cancel, timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    lane.queue.push(job);
    pump(lane);
  });
}
export function buildEpubIndex(bytes, options) {
  if (typeof options?.onBatch !== "function")
    throw new TypeError("Index build requires an onBatch consumer");
  return submit(bytes, { action: "index" }, options);
}
export function replayEpubRanges(bytes, scope, ranges, options) {
  return submit(bytes, { action: "replay", scope, ranges }, options);
}
export function readEpubContext(bytes, scope, range, maxChars, options) {
  return submit(
    bytes,
    { action: "context", scope, ranges: [range], maxChars },
    options,
  );
}
export function expandEpubEvidence(bytes, scope, ranges, options) {
  const { maxChars, maxWindowChars, limit, preserveAllHits = false, ...workerOptions } = options;
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 24000 ||
      !Number.isInteger(maxWindowChars) || maxWindowChars < 1 || maxWindowChars > 12000 ||
      !Number.isInteger(limit) || limit < 1 || limit > (preserveAllHits ? 12 : 5) || !Array.isArray(ranges) || ranges.length > 80 ||
      typeof preserveAllHits !== "boolean" || (preserveAllHits && ranges.length > limit))
    throw new Error("Invalid evidence expansion budget");
  return submit(bytes, { action: "expand", scope, ranges, maxChars, maxWindowChars, limit, preserveAllHits }, workerOptions);
}
export function parseEpub(bytes, options) {
  return submit(bytes, null, options);
}
export function resolveEpubSelection(bytes, expectedScope, request, options) {
  return submit(bytes, { expectedScope, request }, options);
}
async function runWorker(job) {
  const limits = readEpubMemoryLimits();
  const indexing = job.selection?.action === "index";
  const resourceError = () =>
    Object.assign(
      new Error("INDEX_RESOURCE_LIMIT: process RSS budget exceeded"),
      { code: "INDEX_RESOURCE_LIMIT" },
    );
  if (indexing && process.memoryUsage.rss() > limits.rssBytes)
    throw resourceError();
  const worker = new Worker(new URL("./node-worker.js", import.meta.url), {
    workerData: { bytes: new Uint8Array(job.bytes), selection: job.selection },
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: indexing ? limits.indexHeapMiB : limits.interactiveHeapMiB },
  });
  let resourceTimer;
  try {
    return await new Promise((resolve, reject) => {
      job.cancel = reject;
      if (indexing)
        resourceTimer = setInterval(() => {
          if (process.memoryUsage.rss() > limits.rssBytes)
            reject(resourceError());
        }, 25);
      worker.on("message", async (message) => {
        if (message.batch) {
          try {
            await job.onBatch(message.batch);
            worker.postMessage({ ack: true });
          } catch (error) {
            reject(error);
          }
        } else if (message.error)
          reject(
            Object.assign(new Error(message.error.message), {
              name: message.error.name,
              code: message.error.code,
            }),
          );
        else resolve(message.result);
      });
      worker.once("error", reject);
      worker.once("exit", (code) =>
        reject(new Error(`EPUB worker exited without result (${code})`)),
      );
    });
  } finally {
    clearInterval(resourceTimer);
    await worker.terminate();
  }
}

export { CHUNKER_VERSION } from "./chunks.js";
