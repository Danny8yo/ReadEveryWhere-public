// Page-scoped network ownership, independent of any mounted reader component.
// Cache keys include user, book and file version; no cross-user/version sharing.
const pending = new Map<string, Promise<File>>();
export function shareBookFileTransfer(key: string, load: () => Promise<File>): Promise<File> {
  const existing = pending.get(key);
  if (existing) return existing;
  const transfer = load().finally(() => { pending.delete(key); });
  pending.set(key, transfer);
  return transfer;
}
