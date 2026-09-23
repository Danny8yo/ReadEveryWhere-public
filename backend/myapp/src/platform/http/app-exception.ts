export interface ErrorDetails {
  field?: string | null;
  reason: string;
  existingBookId?: number;
  upstream?: unknown;
  node?: unknown;
  recovery?: unknown;
  current?: unknown;
}

/**
 * 统一业务异常对象：约束状态码、业务错误码与细节结构。
 */
export class AppException extends Error {
  public readonly status: number;
  public readonly code: number;
  public readonly details?: ErrorDetails;

  constructor(status: number, code: number, message: string, details?: ErrorDetails) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  // 参数校验失败异常。
  static validation(field: string | null, message = "Parameter validation failed"): AppException {
    return new AppException(400, 40002, message, {
      field,
      reason: "VALIDATION_ERROR",
    });
  }

  // 资源冲突异常。
  static conflict(field: string | null, message = "Resource conflict"): AppException {
    return new AppException(409, 40003, message, {
      field,
      reason: "RESOURCE_CONFLICT",
    });
  }

  // 资源冲突异常（附带已存在资源 ID）。
  static conflictWithExisting(
    field: string | null,
    existingBookId: number,
    message = "Resource conflict",
  ): AppException {
    return new AppException(409, 40003, message, {
      field,
      reason: "RESOURCE_CONFLICT",
      existingBookId,
    });
  }

  static revisionConflict(field: string, message: string, current: unknown): AppException {
    return new AppException(409, 40003, message, {
      field,
      reason: "ANNOTATION_CONFLICT",
      current,
    });
  }

  // 未授权异常。
  static unauthorized(message = "Unauthorized"): AppException {
    return new AppException(401, 40101, message, {
      reason: "UNAUTHORIZED",
    });
  }

  // 禁止访问异常（已登录但无权限）。
  static forbidden(message = "Forbidden"): AppException {
    return new AppException(403, 40301, message, {
      reason: "FORBIDDEN",
    });
  }

  // 资源不存在异常。
  static notFound(field: string | null, message = "Resource not found"): AppException {
    return new AppException(404, 40401, message, {
      field,
      reason: "RESOURCE_NOT_FOUND",
    });
  }

  // 上游服务不可用异常。
  static upstreamUnavailable(message = "External source unavailable", upstream?: unknown): AppException {
    return new AppException(502, 50002, message, {
      reason: "UPSTREAM_UNAVAILABLE",
      upstream,
    });
  }

  // 下载失败异常。
  static downloadFailed(message = "Download failed", upstream?: unknown): AppException {
    return new AppException(502, 50003, message, {
      reason: "DOWNLOAD_FAILED",
      upstream,
    });
  }

  // 资源状态冲突异常。
  static invalidState(field: string | null, message = "Invalid resource state"): AppException {
    return new AppException(409, 40004, message, {
      field,
      reason: "INVALID_STATE",
    });
  }

  // 内部错误异常。
  static internal(message = "Internal server error"): AppException {
    return new AppException(500, 50001, message, {
      reason: "INTERNAL_ERROR",
    });
  }

  static databaseBusy(retryAfterSeconds = 1): AppException {
    return new AppException(503, 50301, "Database is busy, retry shortly", {
      reason: "DATABASE_BUSY",
      recovery: { retryAfterSeconds },
    });
  }
}
