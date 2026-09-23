export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '未知大小';
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error(`Invalid file size: ${bytes}`);
  }

  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = unitIndex === 0
    ? String(value)
    : value.toFixed(1).replace(/\.0$/, '');
  return `${formatted} ${units[unitIndex]}`;
}
