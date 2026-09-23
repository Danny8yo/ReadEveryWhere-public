function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeTitle(title: string): string {
  return normalizeWhitespace(title)
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, "");
}

export function normalizeOptionalString(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeAuthors(authors: string[]): string[] {
  const deduplicated = new Set<string>();
  for (const item of authors) {
    const normalized = normalizeWhitespace(item);
    if (normalized) {
      deduplicated.add(normalized);
    }
  }

  return Array.from(deduplicated);
}

export function parseJsonStringArray(value: string, fieldName = "value"): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be a JSON array of strings`);
  }
  return parsed;
}
