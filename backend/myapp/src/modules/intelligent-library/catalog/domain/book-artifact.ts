export type BookArtifactStatus =
  | "reserved"
  | "ready"
  | "active"
  | "retired"
  | "aborted"
  | "deleted";

export interface BookArtifactValues {
  artifactId: string;
  deliveryId: string;
  ownerId: number;
  bookId: number;
  status: BookArtifactStatus;
  storedPath: string;
  stagingStoredPath: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  checksum: string | null;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  managed: boolean;
  cleanupAfter: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface ReserveBookArtifactInput {
  artifactId: string;
  deliveryId: string;
  ownerId: number;
  bookId: number;
  storedPath: string;
  stagingStoredPath: string | null;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  managed: boolean;
  now?: string;
}

interface ReadyBookArtifactInput {
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
}

export class BookArtifact {
  private constructor(private readonly values: BookArtifactValues) {}

  static reserve(input: ReserveBookArtifactInput): BookArtifact {
    if (!input.artifactId.trim()) throw new Error("artifactId is required");
    if (!input.deliveryId.trim()) throw new Error("deliveryId is required");
    if (!Number.isInteger(input.ownerId) || input.ownerId < 1) throw new Error("ownerId is invalid");
    if (!Number.isInteger(input.bookId) || input.bookId < 1) throw new Error("bookId is invalid");
    if (!input.storedPath.trim()) throw new Error("storedPath is required");
    const now = input.now ?? new Date().toISOString();
    return new BookArtifact({
      ...input,
      status: "reserved",
      fileName: null,
      mimeType: null,
      fileSize: null,
      checksum: null,
      cleanupAfter: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  static rehydrate(values: BookArtifactValues): BookArtifact {
    return new BookArtifact({ ...values });
  }

  get snapshot(): BookArtifactValues { return { ...this.values }; }

  markReady(input: ReadyBookArtifactInput, now = new Date().toISOString()): void {
    this.requireStatus("reserved");
    if (!input.fileName.trim()) throw new Error("fileName is required");
    if (!input.mimeType.trim()) throw new Error("mimeType is required");
    if (!Number.isFinite(input.fileSize) || input.fileSize < 0) throw new Error("fileSize is invalid");
    if (!input.checksum.trim()) throw new Error("checksum is required");
    this.values.fileName = input.fileName;
    this.values.mimeType = input.mimeType;
    this.values.fileSize = input.fileSize;
    this.values.checksum = input.checksum;
    this.values.status = "ready";
    this.values.updatedAt = now;
  }

  activate(now = new Date().toISOString()): void {
    this.requireStatus("ready");
    this.values.status = "active";
    this.values.updatedAt = now;
  }

  retire(cleanupAfter: string, now = new Date().toISOString()): void {
    this.requireStatus("active");
    this.values.status = "retired";
    this.values.cleanupAfter = cleanupAfter;
    this.values.updatedAt = now;
  }

  abort(cleanupAfter: string, now = new Date().toISOString()): void {
    if (this.values.status !== "reserved" && this.values.status !== "ready") {
      throw new Error(`BookArtifact must be reserved or ready, current status is ${this.values.status}`);
    }
    this.values.status = "aborted";
    this.values.cleanupAfter = cleanupAfter;
    this.values.updatedAt = now;
  }

  markDeleted(now = new Date().toISOString()): void {
    if (this.values.status !== "retired" && this.values.status !== "aborted") {
      throw new Error(`BookArtifact must be retired or aborted, current status is ${this.values.status}`);
    }
    this.values.status = "deleted";
    this.values.deletedAt = now;
    this.values.updatedAt = now;
  }

  private requireStatus(expected: BookArtifactStatus): void {
    if (this.values.status !== expected) {
      throw new Error(`BookArtifact must be ${expected}, current status is ${this.values.status}`);
    }
  }
}
