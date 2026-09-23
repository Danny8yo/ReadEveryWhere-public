const TRUSTED_SCOPE_KEYS = new Set(["userId", "bookId", "contentRevision"]);

export function toModelVisibleData(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => toModelVisibleData(item, depth + 1));
  if (typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (TRUSTED_SCOPE_KEYS.has(key)) continue;
    output[key] = toModelVisibleData(item, depth + 1);
  }
  return output;
}
