import { Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { StorageService } from "../../../../platform/storage/storage.service";
import type {
  AllocatedBookArtifactPaths,
  BookArtifactStorePort,
} from "../application/ports/book-artifact-store.port";

@Injectable()
export class StorageBookArtifactAdapter implements BookArtifactStorePort {
  constructor(private readonly storage: StorageService) {}

  allocate(ownerId: number, artifactId: string, fileName: string): AllocatedBookArtifactPaths {
    const extension = extname(fileName).toLowerCase();
    const directory = resolve(this.storage.storageRoot, String(ownerId), "artifacts");
    const stagingDirectory = resolve(directory, ".staging");
    mkdirSync(stagingDirectory, { recursive: true });
    const absolutePath = resolve(directory, `${artifactId}${extension}`);
    const stagingAbsolutePath = resolve(stagingDirectory, `${artifactId}.part`);
    return {
      storedPath: this.storage.toRelative(absolutePath),
      stagingStoredPath: this.storage.toRelative(stagingAbsolutePath),
      absolutePath,
      stagingAbsolutePath,
    };
  }

  stage(content: Buffer, paths: AllocatedBookArtifactPaths): void {
    if (existsSync(paths.absolutePath) || existsSync(paths.stagingAbsolutePath)) {
      throw new Error("Artifact target already exists");
    }
    writeFileSync(paths.stagingAbsolutePath, content, { flag: "wx" });
    renameSync(paths.stagingAbsolutePath, paths.absolutePath);
  }

  adopt(sourceAbsolutePath: string, paths: AllocatedBookArtifactPaths): void {
    if (existsSync(paths.absolutePath) || existsSync(paths.stagingAbsolutePath)) {
      throw new Error("Artifact target already exists");
    }
    renameSync(sourceAbsolutePath, paths.stagingAbsolutePath);
    renameSync(paths.stagingAbsolutePath, paths.absolutePath);
  }

  toStoredPath(absolutePath: string): string {
    return this.storage.toRelative(absolutePath);
  }

  resolveStoredPath(storedPath: string): string {
    return this.storage.resolvePath(storedPath);
  }

  remove(absolutePath: string): void {
    try {
      unlinkSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
