import { createHmac, timingSafeEqual } from "node:crypto";
import { CatalogError } from "../../domain/catalog.error";

export interface BookFileAccessTokenPayload {
  bookId: number;
  userId: number;
  exp: number;
}

const DEFAULT_BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;

/**
 * 过期时间按整点对齐，同一小时内签出的 token 逐字节相同。
 *
 * 目的是让文件 URL 稳定：token 在 query 里，URL 一变浏览器缓存的 key 就变，之前每次开书都
 * 重新签一个 exp，导致缓存 100% 失效——同一本书每次打开都要重新下同样的字节。对齐之后一小时
 * 内重复打开直接命中本地缓存。代价是 token 实际有效期在 TTL 到 TTL+1 小时之间浮动。
 */
const TOKEN_EXPIRY_BUCKET_SECONDS = 60 * 60;

export class CreateBookFileAccessUseCase {
  private readonly ttlSeconds =
    Number(process.env.BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS) ||
    DEFAULT_BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS;

  execute(userId: number, bookId: number) {
    if (!Number.isInteger(bookId) || bookId <= 0) {
      throw CatalogError.validation("id", "Invalid book id");
    }

    const earliestExpiry = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const expiresAt =
      Math.ceil(earliestExpiry / TOKEN_EXPIRY_BUCKET_SECONDS) * TOKEN_EXPIRY_BUCKET_SECONDS;
    const token = this.sign({ bookId, userId, exp: expiresAt });

    return {
      url: `/api/v1/library/books/${bookId}/file?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  verify(token: string): BookFileAccessTokenPayload {
    const [payloadEncoded, signature] = token.split(".");
    if (!payloadEncoded || !signature) {
      throw CatalogError.unauthorized("Invalid file access token");
    }

    const expected = this.signEncodedPayload(payloadEncoded);
    if (!safeEqual(signature, expected)) {
      throw CatalogError.unauthorized("Invalid file access token");
    }

    let payload: BookFileAccessTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8"));
    } catch {
      throw CatalogError.unauthorized("Invalid file access token");
    }

    if (
      !Number.isInteger(payload.bookId) ||
      !Number.isInteger(payload.userId) ||
      !Number.isInteger(payload.exp)
    ) {
      throw CatalogError.unauthorized("Invalid file access token");
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw CatalogError.unauthorized("Expired file access token");
    }

    return payload;
  }

  private sign(payload: BookFileAccessTokenPayload): string {
    const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${payloadEncoded}.${this.signEncodedPayload(payloadEncoded)}`;
  }

  private signEncodedPayload(payloadEncoded: string): string {
    return createHmac("sha256", getFileAccessSecret())
      .update(payloadEncoded)
      .digest("base64url");
  }
}

const getFileAccessSecret = (): string => {
  const secret = process.env.BOOK_FILE_ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret || secret === "read-everywhere-dev-secret") {
    throw new Error("BOOK_FILE_ACCESS_TOKEN_SECRET or JWT_SECRET must be set");
  }
  return secret;
};

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};
