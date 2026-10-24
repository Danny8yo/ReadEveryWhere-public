import { Injectable } from "@nestjs/common";
import { Request, Response } from "express";
import * as fs from "node:fs";
import type { BookFileStreamingQueryPort } from "../../../catalog/application/ports/book-file-streaming-query.port";
import { EBOOK_FORMAT_MIME_TYPES } from "../../../public/ebook-format";

/**
 * 书籍文件是私有内容，只允许存进浏览器自己的缓存，不能进任何共享缓存。
 *
 * max-age 与签名 URL 的过期对齐窗口（1 小时，见 CreateBookFileAccessUseCase）一致：URL 在这
 * 一小时内逐字节稳定，缓存条目才有机会被复用。之前是 max-age=0 且没有校验器，同一本书每次
 * 打开都要把打开阶段那 1MB 多重新下一遍。
 */
const PRIVATE_FILE_CACHE_CONTROL = "private, max-age=3600";
const EXPOSED_FILE_HEADERS = "Accept-Ranges, Content-Length, Content-Range, Cache-Control, ETag, Last-Modified";
const SERVABLE_MIME_TYPES = new Set(Object.values(EBOOK_FORMAT_MIME_TYPES));
/**
 * 文件路由与站点同源，且 /file 只凭签名 URL 即可访问。即使库里存在历史遗留的错误 MIME，
 * 也只按电子书类型下发；直接打开时以 sandbox 文档渲染（无脚本、不透明源），
 * 防止文件被当作 HTML/脚本在站点源下执行。阅读器用 fetch 读取字节，不受这两个头影响。
 */
const FILE_SECURITY_HEADERS = {
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
};

@Injectable()
export class StreamBookFileHttpService {
  constructor(
    private readonly files: BookFileStreamingQueryPort,
  ) {}

  async execute(userId: number, bookId: number, req: Request, res: Response): Promise<void> {
    const row = this.files.findForStreaming({ userId, bookId });

    if (!row) {
      res.status(404).json({ code: 40401, message: "Book file record not found" });
      return;
    }

    if (!row.absolutePath || (row.downloadStatus !== "completed" && row.downloadStatus != null)) {
      res.status(404).json({ code: 40402, message: "Book file is not downloaded or path is missing" });
      return;
    }

    const localPath = row.absolutePath;

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(localPath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      res.status(404).json({ code: 40403, message: "Physical book file not found on disk" });
      return;
    }

    const fileSize = stat.size;
    // 文件一旦落库就不再原地修改（替换走的是新 artifact + 原子 rename），大小加修改时间足以
    // 唯一标识内容，可以当强校验器用，从而支持 If-Range。
    const etag = `"${fileSize.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();
    const mimeType = row.mimeType && SERVABLE_MIME_TYPES.has(row.mimeType)
      ? row.mimeType
      : "application/octet-stream";
    const validatorHeaders = {
      ETag: etag,
      "Last-Modified": lastModified,
      "Cache-Control": PRIVATE_FILE_CACHE_CONTROL,
      "Access-Control-Expose-Headers": EXPOSED_FILE_HEADERS,
    };
    const baseHeaders = {
      ...validatorHeaders,
      ...FILE_SECURITY_HEADERS,
      "Accept-Ranges": "bytes",
      "Content-Type": mimeType,
    };

    // 条件请求优先于 Range：缓存过期后浏览器带 If-None-Match 来问，内容没变就回 304，
    // 省掉整段字节的重传。
    if (matchesEtag(req.headers["if-none-match"], etag)) {
      res.status(304).set(validatorHeaders).end();
      return;
    }

    // If-Range 不匹配说明客户端手里的副本已经过期，此时必须无视 Range 回整份新内容，
    // 否则它会把新旧字节拼在一起。
    const ifRange = req.headers["if-range"];
    const rangeIsUsable = ifRange === undefined || matchesEtag(ifRange, etag);
    const range = rangeIsUsable ? parseRangeHeader(req.headers.range, fileSize) : null;

    if (range) {
      if (range.status === "unsatisfiable") {
        res.status(416).set({
          ...validatorHeaders,
          "Content-Range": `bytes */${fileSize}`,
        }).end();
        return;
      }

      const { start, end } = range;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(localPath, { start, end });

      res.status(206).set({
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunksize.toString(),
      });
      this.pipeWithErrorHandling(file, res);

    } else {
      res.status(200).set({
        ...baseHeaders,
        "Content-Length": fileSize.toString(),
      });

      this.pipeWithErrorHandling(fs.createReadStream(localPath), res);
    }
  }

  private pipeWithErrorHandling(file: fs.ReadStream, res: Response): void {
    file.once("error", (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      if (!isMissingFileError(error)) {
        res.destroy(error);
        return;
      }
      res.status(404).json({ code: 40403, message: "Physical book file not found on disk" });
    });
    // pipe 不会在客户端中途断开时关闭源文件；pdf.js 取消 Range 请求、断网都会走到这里，
    // 不显式销毁就会每次泄漏一个文件描述符，最终 EMFILE 拖垮整个服务。
    res.once("close", () => file.destroy());
    file.pipe(res);
  }
}

type ParsedRange =
  | { status: "ok"; start: number; end: number }
  | { status: "unsatisfiable" }
  | null;

const parseRangeHeader = (rangeHeader: string | undefined, fileSize: number): ParsedRange => {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || fileSize <= 0) return { status: "unsatisfiable" };

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { status: "unsatisfiable" };

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { status: "unsatisfiable" };
    }
    const start = Math.max(fileSize - suffixLength, 0);
    return { status: "ok", start, end: fileSize - 1 };
  }

  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : fileSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= fileSize
  ) {
    return { status: "unsatisfiable" };
  }

  return { status: "ok", start, end: Math.min(requestedEnd, fileSize - 1) };
};

/** If-None-Match / If-Range 的比对：支持 `*`、逗号分隔的多值，以及弱校验器前缀。 */
const matchesEtag = (header: string | string[] | undefined, etag: string): boolean => {
  if (typeof header !== "string" || header.length === 0) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//u, ""))
    .includes(etag);
};

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
