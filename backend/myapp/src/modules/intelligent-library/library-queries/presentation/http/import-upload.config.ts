const BYTES_PER_MEGABYTE = 1024 * 1024;
const DEFAULT_IMPORT_MAX_FILE_SIZE_MB = 200;

export interface ImportCapabilities {
  maxFileSizeBytes: number;
}

export function resolveImportMaxFileSizeBytes(
  rawValue: string | undefined = process.env.IMPORT_MAX_FILE_SIZE_MB,
): number {
  if (rawValue === undefined) {
    return DEFAULT_IMPORT_MAX_FILE_SIZE_MB * BYTES_PER_MEGABYTE;
  }

  const megabytes = Number(rawValue);
  if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(megabytes) || megabytes <= 0) {
    throw new Error(
      `IMPORT_MAX_FILE_SIZE_MB must be a positive integer, received: ${JSON.stringify(rawValue)}`,
    );
  }

  const bytes = megabytes * BYTES_PER_MEGABYTE;
  if (!Number.isSafeInteger(bytes)) {
    throw new Error(`IMPORT_MAX_FILE_SIZE_MB is too large: ${rawValue}`);
  }
  return bytes;
}

export const IMPORT_CAPABILITIES: Readonly<ImportCapabilities> = Object.freeze({
  maxFileSizeBytes: resolveImportMaxFileSizeBytes(),
});
