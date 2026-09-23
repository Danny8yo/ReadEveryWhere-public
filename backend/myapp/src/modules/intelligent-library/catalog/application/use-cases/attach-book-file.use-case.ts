import { randomUUID } from "node:crypto";
import { PDF_MIME_TYPE } from "../../domain/ebook-format";
import type { AttachCatalogBookFileCommand, AttachedBookFileProjection } from "../catalog.commands";
import { BookArtifact } from "../../domain/book-artifact";
import type { BookArtifactStorePort } from "../ports/book-artifact-store.port";
import type { PdfPageTreeOptimizerPort } from "../ports/pdf-page-tree-optimizer.port";
import type { BookArtifactRepositoryPort } from "../ports/book-artifact-repository.port";
import type { BookRepositoryPort } from "../ports/book-repository.port";

export class AttachBookFileUseCase {
  constructor(
    private readonly books: BookRepositoryPort,
    private readonly artifactRepository: BookArtifactRepositoryPort,
    private readonly artifacts: BookArtifactStorePort,
    private readonly pdfPageTrees: PdfPageTreeOptimizerPort,
  ) {}

  async execute(command: Readonly<AttachCatalogBookFileCommand>): Promise<AttachedBookFileProjection> {
    if (!this.books.isOwnedBy(command.userId, command.bookId)) {
      throw new Error("Book not found while attaching downloaded file");
    }
    const deliveryId = command.deliveryId ?? randomUUID();
    const existing = this.artifactRepository.findByDeliveryId(command.userId, deliveryId);
    if (existing?.snapshot.status === "active") {
      const value = existing.snapshot;
      return {
        deliveryId: value.deliveryId,
        artifactId: value.artifactId,
        localPath: this.artifacts.resolveStoredPath(value.storedPath),
        storedPath: value.storedPath,
        checksum: value.checksum ?? command.checksum,
      };
    }
    if (existing) throw new Error(`Artifact delivery is already ${existing.snapshot.status}`);

    const artifactId = randomUUID();
    const paths = this.artifacts.allocate(command.userId, artifactId, command.fileName);
    const now = new Date().toISOString();
    const artifact = BookArtifact.reserve({
      artifactId,
      deliveryId,
      ownerId: command.userId,
      bookId: command.bookId,
      storedPath: paths.storedPath,
      stagingStoredPath: paths.stagingStoredPath,
      sourcePlatform: command.sourcePlatform,
      sourceUrl: command.sourceUrl,
      managed: true,
      now,
    });
    this.artifactRepository.reserve(artifact);
    try {
      if (command.content) this.artifacts.stage(command.content, paths);
      else if (command.localPath) this.artifacts.adopt(command.localPath, paths);
      else throw new Error("localPath or content is required");
      // PDF 在落库前重建页树。pdf.js 打开文档时必然会取到最后一页，扁平页树会逼它把
      // 整本书拉一遍（111MB 的书要先读 110MB），重建后只读约 1MB。重建改变文件字节，
      // 所以 fileSize 取磁盘上的实际大小；checksum 始终是来源字节的指纹（导入查重口径），
      // 没有任何代码拿它去校验磁盘文件。
      const fileSize = command.mimeType === PDF_MIME_TYPE
        ? (await this.pdfPageTrees.optimize(paths.absolutePath)).fileSize
        : command.fileSize;
      artifact.markReady({
        fileName: command.fileName,
        mimeType: command.mimeType,
        fileSize,
        checksum: command.checksum,
      });
      artifact.activate();
      this.artifactRepository.activate(artifact, afterHours(24));
      return {
        deliveryId,
        artifactId,
        localPath: paths.absolutePath,
        storedPath: paths.storedPath,
        checksum: command.checksum,
      };
    } catch (error) {
      this.artifactRepository.abort(artifactId, afterHours(24), new Date().toISOString());
      throw error;
    }
  }
}

function afterHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
