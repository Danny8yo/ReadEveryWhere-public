import { Injectable } from "@nestjs/common";
import { isAbsolute, relative, resolve, sep } from "node:path";

@Injectable()
export class StorageService {
  readonly storageRoot: string;

  constructor() {
    this.storageRoot = resolve(
      process.cwd(),
      process.env.DOWNLOAD_STORAGE_PATH ?? "data/downloads",
    );
  }

  toRelative(absolutePath: string): string {
    const normalized = resolve(absolutePath);
    if (!this.isWithinRoot(normalized)) {
      return normalized;
    }
    const rel = relative(this.storageRoot, normalized);
    return rel || ".";
  }

  resolvePath(stored: string): string {
    const resolved = isAbsolute(stored)
      ? resolve(stored)
      : resolve(this.storageRoot, stored);

    if (!this.isWithinRoot(resolved)) {
      throw new Error(`Path traversal detected: ${stored}`);
    }
    return resolved;
  }

  private isWithinRoot(candidate: string): boolean {
    return candidate === this.storageRoot || candidate.startsWith(`${this.storageRoot}${sep}`);
  }
}
