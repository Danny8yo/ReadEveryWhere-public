/** Decode EPUB resource bytes identically across Node and browser hosts; malformed data throws. */
export function decodeEpubText(bytes: Uint8Array, mediaType: string): string;
