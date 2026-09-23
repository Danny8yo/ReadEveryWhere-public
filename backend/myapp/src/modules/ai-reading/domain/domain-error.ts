export class AiReadingDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(`${code}: ${message}`);
    this.name = 'AiReadingDomainError';
  }
}

export function requireNonEmpty(value: string, code: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AiReadingDomainError(code, `${field} must not be empty`, { field });
  }
}

export function requireIsoDate(value: string, code: string, field: string): void {
  requireNonEmpty(value, code, field);
  if (!Number.isFinite(Date.parse(value))) {
    throw new AiReadingDomainError(code, `${field} must be an ISO date`, { field });
  }
}

export function jsonClone<T>(value: T, code: string): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new AiReadingDomainError(code, 'value must be JSON serializable');
  }
}
