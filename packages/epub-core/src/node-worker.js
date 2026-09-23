import { once } from "node:events";
import { chunkSection, CHUNKER_VERSION, surroundingRange, structureUnits } from "./chunks.js";
import { tokenizeKeywords, TOKENIZER_VERSION } from "./keywords.js";
import * as CFI from "./foliate/epubcfi.js";
import { parentPort, workerData } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { openEpubArchive, safeArchivePath } from "./node-zip.js";
import {
  buildSourceMap,
  canonicalOffsetAtElement,
  parseChapter,
  resolveSelection,
  addressOf,
  LocationError,
  EPUB_EXTRACTOR_VERSION,
  NORMALIZATION_VERSION,
  canonicalToSource,
  rangeFromSource,
} from "./index.js";
import { Resources, loadPackage, parseNav, parseNCX } from "./foliate/epub.js";

const host = new JSDOM("");
for (const name of [
  "DOMParser",
  "XMLSerializer",
  "Node",
  "NodeFilter",
  "ProcessingInstruction",
  "CustomEvent",
  "EventTarget",
])
  globalThis[name] = host.window[name];
try {
  const action = workerData.selection?.action;
  const preserveAllHits = action === "expand" && workerData.selection.preserveAllHits === true;
  let preservedCaps;
  if (preserveAllHits) {
    const { ranges, limit, maxChars, maxWindowChars } = workerData.selection;
    if (ranges.length > limit) throw new Error("Invalid preserved hit count");
    const lengths = ranges.map(input => {
      if (!Number.isSafeInteger(input.start) || !Number.isSafeInteger(input.end) || input.start < 0 || input.end <= input.start)
        throw new LocationError("RANGE_OUT_OF_BOUNDS", "invalid selected hit range");
      return input.end - input.start;
    });
    const required = lengths.reduce((total, length) => total + length, 0);
    if (required > maxChars || lengths.some(length => length > maxWindowChars))
      throw new LocationError("CONTEXT_BUDGET_EXHAUSTED", "budget cannot preserve every selected hit in full");
    let extra = maxChars - required;
    // Reserve every original first; allocate only the surplus in semantic rank order.
    preservedCaps = lengths.map(length => {
      const allowance = Math.min(extra, maxWindowChars - length);
      extra -= allowance;
      return length + allowance;
    });
  }
  const selection = action ? null : workerData.selection;
  const requestedScope =
    selection?.expectedScope ?? workerData.selection?.scope;
  if (
    requestedScope &&
    requestedScope.extractorVersion !== EPUB_EXTRACTOR_VERSION
  )
    throw new LocationError("VERSION_MISMATCH", "extractor version");
  if (
    requestedScope &&
    requestedScope.fileChecksum !==
      `sha256:${createHash("sha256").update(workerData.bytes).digest("hex")}`
  )
    throw new LocationError("VERSION_MISMATCH", "file checksum");
  const archive = openEpubArchive(workerData.bytes);
  const reference = (base, href) => {
    if (/^[a-z][a-z\d+.-]*:/iu.test(href) || href.startsWith("/"))
      throw new Error(`External EPUB reference: ${href}`);
    const [path, fragment] = href.split("#", 2);
    const normalized = safeArchivePath(
      posix.normalize(
        path ? posix.join(posix.dirname(base), decodeURI(path)) : base,
      ),
    );
    return fragment ? `${normalized}#${fragment}` : normalized;
  };
  const readXML = async (path) => {
    const text = archive.text(path, "application/xml");
    if (text === null) return null;
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (document.querySelector("parsererror"))
      throw new Error(`Invalid EPUB XML: ${path}`);
    return document;
  };
  const { opf, opfPath } = await loadPackage(readXML);
  const resources = new Resources({
    opf,
    resolveHref: (href) => reference(opfPath, href),
  });
  if (!resources.spine.length) throw new Error("EPUB spine is empty");
  if (action === "index") {
    let total = 0;
    for (const spine of resources.spine) {
      const item = resources.getItemByID(spine.idref);
      if (!item) throw new Error("Missing EPUB manifest item");
      const size = archive.size(item.href);
      if (size > 2 * 1024 * 1024)
        throw new LocationError(
          "INDEX_RESOURCE_LIMIT",
          "chapter exceeds indexing budget (2 MiB)",
        );
      total += size;
    }
    if (total > 8 * 1024 * 1024)
      throw new LocationError(
        "INDEX_RESOURCE_LIMIT",
        "spine text exceeds indexing budget (8 MiB)",
      );
  }
  const sections = [],
    replayed = [];
  let expandedHitCount = 0;
  let chunkCount = 0,
    batch = [],
    unavailable = [];
  const flush = async () => {
    if (!batch.length) return;
    parentPort.postMessage({ batch });
    await once(parentPort, "message");
    batch = [];
  };
  for (const [sectionIndex, spineItem] of resources.spine.entries()) {
    const section = resources.getItemByID(spineItem.idref);
    if (!section)
      throw new Error(`Missing EPUB manifest item: ${spineItem.idref}`);
    section.id = section.href;
    if (!archive.has(section.id))
      throw new Error(`Missing EPUB spine resource: ${section.id}`);
    // A local selection/read must not allocate DOM/source maps for the whole book.
    if (selection && sectionIndex !== selection.expectedScope.sectionIndex) continue;
    if ((action === "replay" || action === "context" || action === "expand") &&
        !workerData.selection.ranges.some(r => r.sectionIndex === sectionIndex)) continue;
    const document = parseChapter(
      archive.text(section.id, section.mediaType),
      section.mediaType,
      new DOMParser(),
    ).document;
    if (!document.body || document.querySelector("parsererror"))
      throw new Error(`Unsupported EPUB chapter: ${section.id}`);
    const map = buildSourceMap(document);
    if (selection) {
      const { expectedScope, request } = selection;
      if (section.href !== expectedScope.href)
        throw new LocationError("SCOPE_MISMATCH", "section href");
      let verifiedRequest = request;
      if (request.cfi) {
        const resolved = resources.resolveCFI(request.cfi);
        if (resolved.index !== sectionIndex)
          throw new LocationError("SCOPE_MISMATCH", "CFI resource");
        const range = resolved.anchor(document);
        verifiedRequest = {
          ...request,
          source: {
            start: {
              path: addressOf(range.startContainer),
              offset: range.startOffset,
            },
            end: {
              path: addressOf(range.endContainer),
              offset: range.endOffset,
            },
          },
        };
      }
      parentPort.postMessage({
        result: resolveSelection(document, map, expectedScope, verifiedRequest),
      });
      host.window.close();
      process.exit(0);
    }
    if (action === "index") {
      let firstStart = null,
        lastEnd = 0;
      for (const chunk of chunkSection(
        document,
        map,
        resources.cfis[sectionIndex],
      )) {
        if (
          firstStart !== null &&
          chunk.start > lastEnd &&
          map.text.slice(lastEnd, chunk.start).trim()
        )
          unavailable.push({
            sectionIndex,
            href: section.href,
            reason: "SYNTHETIC_GAP",
            start: lastEnd,
            end: chunk.start,
          });
        firstStart ??= chunk.start;
        lastEnd = chunk.end;
        const tokens = tokenizeKeywords(chunk.quote).join(" ");
        batch.push({
          ...chunk,
          sectionIndex,
          href: section.href,
          ordinal: chunkCount++,
          quoteHash: createHash("sha256").update(chunk.quote).digest("hex"),
          tokens,
        });
        if (batch.length >= 16) await flush();
      }
      if (firstStart === null && map.text.trim())
        unavailable.push({
          sectionIndex,
          href: section.href,
          reason: "SYNTHETIC_ONLY",
          start: 0,
          end: map.text.length,
        });
      else if (firstStart !== null) {
        if (map.text.slice(0, firstStart).trim())
          unavailable.push({
            sectionIndex,
            href: section.href,
            reason: "SYNTHETIC_EDGE",
            start: 0,
            end: firstStart,
          });
        if (map.text.slice(lastEnd).trim())
          unavailable.push({
            sectionIndex,
            href: section.href,
            reason: "SYNTHETIC_EDGE",
            start: lastEnd,
            end: map.text.length,
          });
      }
      continue;
    }
    if (action === "expand") {
      if (requestedScope.normalizationVersion !== NORMALIZATION_VERSION)
        throw new LocationError("VERSION_MISMATCH", "normalization");
      const render = (start, end) => {
        const source = canonicalToSource(map, { start, end });
        const range = rangeFromSource(document, source);
        const quote = map.text.slice(start, end);
        return { sectionIndex, href: section.href, start, end, quote,
          quoteHash: createHash("sha256").update(quote).digest("hex"),
          cfi: CFI.joinIndir(resources.cfis[sectionIndex], CFI.fromRange(range)),
          displayedQuote: range.toString(), source };
      };
      const windows = [];
      const units = structureUnits(document, map);
      for (const [rank, input] of workerData.selection.ranges.entries()) {
        if (input.sectionIndex !== sectionIndex) continue;
        if (input.href !== section.href) throw new LocationError("SCOPE_MISMATCH", "href");
        const original = render(input.start, input.end);
        expandedHitCount++;
        if (original.quoteHash !== input.quoteHash || original.cfi !== input.cfi ||
            (input.quote !== undefined && input.quote !== original.quote) ||
            (input.displayedQuote !== undefined && input.displayedQuote !== original.displayedQuote))
          throw new LocationError("QUOTE_MISMATCH", "stored expansion hit range/hash/CFI/quote");
        const cap = preserveAllHits ? preservedCaps[rank] : Math.min(workerData.selection.maxChars, workerData.selection.maxWindowChars);
        if (input.end - input.start > cap) continue;
        const expanded = surroundingRange(map, input.start, input.end, cap, document, units);
        const hit = { sectionIndex, start: input.start, end: input.end };
        if (preserveAllHits) {
          // Selected ranges may overlap strongly while carrying different edge evidence.
          // Keep each independently: approximate deduplication cannot revoke a selection.
          windows.push({ ...render(expanded.start, expanded.end), hitRanges: [hit],
            contextTruncated: expanded.contextTruncated, rank, original });
          continue;
        }
        const overlap = windows.find(w => Math.min(w.end, expanded.end) > Math.max(w.start, expanded.start));
        if (overlap) {
          const start = Math.min(overlap.start, expanded.start), end = Math.max(overlap.end, expanded.end);
          if (end - start <= cap) {
            Object.assign(overlap, render(start, end));
            overlap.hitRanges.push(hit);
            overlap.contextTruncated ||= expanded.contextTruncated;
          } else if (input.start >= overlap.start && input.end <= overlap.end) overlap.hitRanges.push(hit);
          else windows.push({ ...render(expanded.start, expanded.end), hitRanges: [hit],
            contextTruncated: expanded.contextTruncated, rank, original });
        } else windows.push({ ...render(expanded.start, expanded.end), hitRanges: [hit],
          contextTruncated: expanded.contextTruncated, rank, original });
      }
      replayed.push(...windows);
      continue;
    }
    if (action === "replay" || action === "context") {
      if (requestedScope.normalizationVersion !== NORMALIZATION_VERSION)
        throw new LocationError("VERSION_MISMATCH", "normalization");
      for (const input of workerData.selection.ranges.filter(
        (r) => r.sectionIndex === sectionIndex,
      )) {
        if (input.href !== section.href)
          throw new LocationError("SCOPE_MISMATCH", "href");
        let { start, end } = input;
        let contextTruncated;
        if (action === "context") {
          if (end > map.text.length) throw new LocationError("RANGE_OUT_OF_BOUNDS", `chapter length is ${map.text.length}; requested end ${end}`);
          ({ start, end, contextTruncated } = surroundingRange(
            map,
            start,
            end,
            workerData.selection.maxChars,
            document,
          ));
        }
        const source = canonicalToSource(map, { start, end }),
          range = rangeFromSource(document, source);
        const cfi = CFI.joinIndir(
          resources.cfis[sectionIndex],
          CFI.fromRange(range),
        );
        const quote = map.text.slice(start, end),
          quoteHash = createHash("sha256").update(quote).digest("hex");
        if (
          action === "replay" &&
          (quoteHash !== input.quoteHash || cfi !== input.cfi)
        )
          throw new LocationError("QUOTE_MISMATCH", "stored range/hash/CFI");
        replayed.push({
          sectionIndex,
          href: section.href,
          start,
          end,
          quote,
          quoteHash,
          cfi,
          displayedQuote: range.toString(),
          source,
          ...(action === "context" ? { contextTruncated } : {}),
        });
      }
      continue;
    }
    const offset = (element) => canonicalOffsetAtElement(map, element);
    const anchors = Object.create(null);
    for (const element of document.body.querySelectorAll("[id],[name]")) {
      const name = element.getAttribute("id") ?? element.getAttribute("name");
      if (name && !Object.hasOwn(anchors, name))
        anchors[name] = offset(element);
    }
    const headings = [];
    const fragmentHeadingIndexes = Object.create(null);
    for (const element of document.body.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const index =
        headings.push({
          level: Number(element.localName.slice(1)),
          label: element.textContent.trim().normalize("NFC"),
          start: offset(element),
        }) - 1;
      for (const candidate of [
        element,
        ...element.querySelectorAll("[id],[name]"),
      ]) {
        const fragment =
          candidate.getAttribute("id") ?? candidate.getAttribute("name");
        if (fragment && !Object.hasOwn(fragmentHeadingIndexes, fragment))
          fragmentHeadingIndexes[fragment] = index;
      }
    }
    const firstHeading = document.body.querySelector("h1,h2,h3");
    sections.push({
      sectionIndex,
      href: section.id,
      text: map.text,
      charCount: map.text.length,
      anchors,
      headings,
      fragmentHeadingIndexes,
      title:
        firstHeading?.textContent.trim() ||
        document.querySelector("title")?.textContent.trim() ||
        map.text
          .split("\n")
          .find((line) => line.trim())
          ?.slice(0, 120) ||
        `Section ${sectionIndex + 1}`,
    });
  }
  if (action === "index") {
    await flush();
    parentPort.postMessage({
      result: {
        chunkCount,
        unavailable,
        chunkerVersion: CHUNKER_VERSION,
        tokenizerVersion: TOKENIZER_VERSION,
      },
    });
    host.window.close();
    process.exit(0);
  }
  if (action === "expand") {
    if (expandedHitCount !== workerData.selection.ranges.length)
      throw new LocationError("SCOPE_MISMATCH", "missing expansion resource");
    if (preserveAllHits) {
      const output = replayed.sort((a, b) => a.rank - b.rank).map(({ rank, original, ...evidence }) => evidence);
      if (output.length !== workerData.selection.ranges.length ||
          output.reduce((total, evidence) => total + evidence.quote.length, 0) > workerData.selection.maxChars ||
          workerData.selection.ranges.some((hit, rank) => {
            const window = output[rank];
            return window.sectionIndex !== hit.sectionIndex || window.start > hit.start || window.end < hit.end;
          })) throw new Error("Preserved evidence expansion lost a selected hit or exceeded its budget");
      parentPort.postMessage({ result: output });
      host.window.close(); process.exit(0);
    }
    const output = [];
    let remaining = workerData.selection.maxChars;
    for (const candidate of replayed.sort((a, b) => a.rank - b.rank)) {
      if (output.length >= workerData.selection.limit) break;
      let { rank, original, ...evidence } = candidate;
      if (evidence.quote.length > remaining) {
        if (original.quote.length > remaining) continue;
        evidence = { ...original, hitRanges: candidate.hitRanges.filter(h => h.start >= original.start && h.end <= original.end), contextTruncated: true };
      }
      if (output.some(e => e.sectionIndex === evidence.sectionIndex &&
          Math.max(0, Math.min(e.end, evidence.end) - Math.max(e.start, evidence.start)) /
          Math.min(e.end - e.start, evidence.end - evidence.start) >= 0.8)) continue;
      output.push(evidence); remaining -= evidence.quote.length;
    }
    parentPort.postMessage({ result: output });
    host.window.close(); process.exit(0);
  }
  if (action === "replay" || action === "context" || action === "expand") {
    if (replayed.length !== workerData.selection.ranges.length)
      throw new LocationError("SCOPE_MISMATCH", "missing resource");
    parentPort.postMessage({ result: replayed });
    host.window.close();
    process.exit(0);
  }
  if (selection) throw new LocationError("SCOPE_MISMATCH", "section index");
  let toc = [],
    tocSource = null;
  const { ncxPath, navPath } = resources;
  if (ncxPath) {
    toc =
      parseNCX(await readXML(ncxPath), (href) => reference(ncxPath, href))
        .toc ?? [];
    if (toc.length) tocSource = "ncx";
  }
  if (!toc.length && navPath) {
    toc =
      parseNav(
        parseChapter(
          archive.text(navPath, "application/xhtml+xml"),
          "application/xhtml+xml",
          new DOMParser(),
        ).document,
        (href) => reference(navPath, href),
      ).toc ?? [];
    if (toc.length) tocSource = "epub_nav";
  }
  const convert = (node) => ({
    label: node.label || "Untitled",
    href: node.href,
    children: (node.subitems ?? []).map(convert),
  });
  parentPort.postMessage({
    result: { sections, toc: toc.map(convert), tocSource },
  });
} catch (error) {
  parentPort.postMessage({
    error: {
      name: error instanceof Error ? error.name : "Error",
      code: error.code ?? "EPUB_PARSE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    },
  });
} finally {
  host.window.close();
}
