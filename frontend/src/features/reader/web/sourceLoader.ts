import {
  EPUB_EXTRACTOR_VERSION,
  NORMALIZATION_VERSION,
} from "@readeverywhere/epub-core";
import { fetchWithAuth, resolveBackendUrl } from "../../../services/apiClient";
import { createBookFileAccessUrl } from "../../library/api/libraryApi";
import {
  buildBookFileCacheKey,
  getCachedBookFile,
  putCachedBookFile,
  type BookFileCacheDescriptor,
} from "../../../services/bookFileCache";
import {
  getBookFormat,
  getBookFormatMimeType,
} from "../../../utils/bookFormat";
import { shouldDownloadPdfWhole } from "../../../lib/reader/pdfLoadStrategy";
import { resolvePdfLoadingMode } from "../../../lib/reader/pdfLoadingMode";
import { shareBookFileTransfer } from "../../../services/bookFileTransfers";
import type { ReaderSource } from "./WebReaderPort";
export interface ReaderSourceInput {
  bookId: number;
  userId: number;
  fileName: string;
  mimeType: string | null;
  checksum?: string | null;
  fileSize?: number | null;
  updatedAt: string;
  version: number;
}
export function createReaderSourceLoader(
  props: ReaderSourceInput,
  onMessage: (message: string) => void,
) {
  let detached = false;
  const detach = () => { detached = true; };
  const notify = (message: string) => { if (!detached) onMessage(message); };
  const requireAttached = () => { if (detached) throw new DOMException("阅读器已关闭，文件下载仍可完成", "AbortError"); };
  const bookFormat = getBookFormat(props);
  const pdfLoadingMode = resolvePdfLoadingMode(
    import.meta.env.VITE_PDF_LOADING_MODE,
  );
  async function loadReaderSource(): Promise<ReaderSource> {
    requireAttached();
    if (
      bookFormat === "pdf" &&
      !shouldDownloadPdfWhole(props.fileSize, pdfLoadingMode)
    ) {
      const { url } = await createBookFileAccessUrl(props.bookId);
      requireAttached();
      notify("正在打开 PDF...");
      return { kind: "url", url: resolveBackendUrl(url) };
    }
    const cacheDesc: BookFileCacheDescriptor = {
      userId: props.userId,
      bookId: props.bookId,
      checksum: props.checksum ?? null,
      updatedAt: props.updatedAt,
      version: props.version,
      fileName: props.fileName ?? null,
      mimeType: props.mimeType ?? null,
    };
    notify(`正在加载 ${bookFormat.toUpperCase()}...`);
    const file = await shareBookFileTransfer(buildBookFileCacheKey(cacheDesc), () => loadWholeFile(cacheDesc));
    requireAttached();
    return fileSource(file);
  }
  async function loadWholeFile(cacheDesc: BookFileCacheDescriptor): Promise<File> {
    const formatLabel = bookFormat.toUpperCase();
    const cachedFile = await getCachedBookFile(cacheDesc);
    if (cachedFile) {
      notify(`正在从本地缓存打开 ${formatLabel}...`);
      return cachedFile;
    }
    const { url } = await createBookFileAccessUrl(props.bookId);
    notify(`正在下载 ${formatLabel}...`);
    const resp = await fetchWithAuth(resolveBackendUrl(url), {}, false);
    if (!resp.ok) {
      if (resp.status === 401) throw new Error("文件访问链接已失效，请重新打开书籍获取新链接。");
      throw new Error(`下载文件失败 (${resp.status})`);
    }
    const blob = await readBlobWithOptionalProgress(resp, formatLabel);
    notify(`正在解析 ${formatLabel}...`);
    await putCachedBookFile(cacheDesc, blob);
    const file = createReaderFile(blob);
    return file;
  }
  async function fileSource(file: File): Promise<ReaderSource> {
    if (bookFormat !== "epub") return { kind: "file", file };
    if (!globalThis.crypto?.subtle)
      return {
        kind: "file",
        file,
        qaUnavailableReason:
          "当前浏览器环境不支持安全文件校验，选区问答不可用；普通阅读不受影响。请使用 HTTPS 或本机 localhost。",
      };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    requireAttached();
    const hex = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return {
      kind: "file",
      file,
      epubIdentity: {
        fileChecksum: `sha256:${hex}`,
        extractorVersion: EPUB_EXTRACTOR_VERSION,
        normalizationVersion: NORMALIZATION_VERSION,
      },
    };
  }
  async function readBlobWithOptionalProgress(
    resp: Response,
    label: string,
  ): Promise<Blob> {
    const contentType = resp.headers.get("Content-Type") || undefined;
    const totalBytes = Number(resp.headers.get("Content-Length") ?? 0);
    if (!resp.body || !Number.isFinite(totalBytes) || totalBytes <= 0) {
      return resp.blob();
    }
    const reader = resp.body.getReader();
    const chunks: BlobPart[] = [];
    let receivedBytes = 0;
    let shownPercent = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(new Uint8Array(value));
      receivedBytes += value.byteLength;
      const percent = Math.min(
        99,
        Math.floor((receivedBytes / totalBytes) * 100),
      );
      if (percent !== shownPercent) {
        shownPercent = percent;
        notify(`正在下载 ${label}... ${percent}%`);
      }
    }
    return new Blob(chunks, { type: contentType });
  }
  function createReaderFile(blob: Blob): File {
    return new File([blob], props.fileName || `book.${bookFormat}`, {
      type: blob.type || props.mimeType || getBookFormatMimeType(bookFormat),
    });
  }
  return { loadReaderSource, detach };
}
