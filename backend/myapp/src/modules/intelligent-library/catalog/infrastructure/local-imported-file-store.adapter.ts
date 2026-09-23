import { Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { StorageService } from "../../../../platform/storage/storage.service";
import type { ImportedFileStorePort } from "../application/ports/imported-file-store.port";

@Injectable()
export class LocalImportedFileStoreAdapter implements ImportedFileStorePort {
  constructor(private readonly storage: StorageService) {}

  pathForImport(ownerId: number, fileName: string): string {
    const directory = resolve(this.storage.storageRoot, String(ownerId), "imports");
    mkdirSync(directory, { recursive: true });
    return resolve(directory, fileName);
  }

  stagingPathForImport(ownerId: number, fileName: string): string {
    const directory = resolve(this.storage.storageRoot, String(ownerId), "imports", ".staging");
    mkdirSync(directory, { recursive: true });
    return resolve(directory, `${randomUUID()}-${fileName}`);
  }

  exists(absolutePath: string): boolean { return existsSync(absolutePath); }
  write(absolutePath: string, content: Buffer): void { writeFileSync(absolutePath, content); }
  remove(absolutePath: string): void {
    try {
      unlinkSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
