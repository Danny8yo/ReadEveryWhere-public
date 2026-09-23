const MAX_TEXT_QUOTE_CHARACTERS = 256;
const TEXT_QUOTE_CONTEXT_CHARACTERS = 64;

export function citationForEvidenceChunk(
  citation: Record<string, unknown>,
  readText: string,
  offset: number,
  quote: string,
): Record<string, unknown> {
  const locator = citation.locator as any;
  if (!locator?.position || locator.position.kind !== "epub_text") {
    return { ...citation, locator };
  }

  const start = locator.position.start + offset;
  const end = start + quote.length;
  return {
    ...citation,
    quote,
    locator: {
      ...locator,
      position: { ...locator.position, start, end },
      textQuote: {
        exact: quote.slice(0, MAX_TEXT_QUOTE_CHARACTERS),
        prefix: readText.slice(
          Math.max(0, offset - TEXT_QUOTE_CONTEXT_CHARACTERS),
          offset,
        ) || undefined,
        suffix: readText.slice(
          offset + quote.length,
          offset + quote.length + TEXT_QUOTE_CONTEXT_CHARACTERS,
        ) || undefined,
      },
    },
  };
}
