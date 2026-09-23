import { ANNOTATION_SELECTION_COMMAND_PORT } from "../src/modules/reading-state/public";
import { BOOK_SELECTION_PORT, CURRENT_BOOK_ARTIFACT_FENCE_PORT } from "../src/modules/intelligent-library/public";
import { INestApplication } from "@nestjs/common";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadCompatExport } from "../characterization/compat-loader";
import { createCompatApp } from "./compat-e2e.helper";

const currentPortPath = resolve(
  process.cwd(),
  "src/modules/reading-state/public/annotation-query.port.ts",
);
const isCurrentArchitecture = existsSync(currentPortPath);

describe("ReadingState production Nest module graph (e2e)", () => {
  let app: INestApplication;
  let root = "";

  beforeAll(async () => {
    root = mkdtempSync(resolve(tmpdir(), "read-everywhere-reading-state-module-"));
    app = await createCompatApp(root);
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("initializes the real graph and resolves annotation-backed Reader Tools dependencies", () => {
    const GetBookMetadataUseCase = loadCompatExport<any>([
      "src/interface-adapters/reader-tools-http/application/get-book-metadata.use-case",
      "src/book-content/application/use-cases/get-book-metadata.use-case",
    ], "GetBookMetadataUseCase");
    const ListBookAnnotationsUseCase = loadCompatExport<any>([
      "src/interface-adapters/reader-tools-http/application/list-book-annotations.use-case",
      "src/book-content/application/use-cases/list-book-annotations.use-case",
    ], "ListBookAnnotationsUseCase");

    expect(app.get(ANNOTATION_SELECTION_COMMAND_PORT).execute).toEqual(expect.any(Function));
    expect(app.get(ANNOTATION_SELECTION_COMMAND_PORT).findReceipt(1, "missing-command")).toBeNull();
    expect(app.get(BOOK_SELECTION_PORT).resolveSelection).toEqual(expect.any(Function));
    expect(app.get(CURRENT_BOOK_ARTIFACT_FENCE_PORT).assertCurrent).toEqual(expect.any(Function));
    expect(app.get(GetBookMetadataUseCase)).toBeInstanceOf(GetBookMetadataUseCase);
    expect(app.get(ListBookAnnotationsUseCase)).toBeInstanceOf(ListBookAnnotationsUseCase);

    if (isCurrentArchitecture) {
      const annotationQueryPort = loadCompatExport<symbol>([
        "src/modules/reading-state/public/annotation-query.port",
      ], "ANNOTATION_QUERY_PORT");
      const port = app.get<any>(annotationQueryPort);
      expect(port).toBeDefined();
      expect(port.listByBook).toEqual(expect.any(Function));
      expect(port.listByBook({ userId: 1, bookId: 1 })).toEqual([]);
      return;
    }

    const AnnotationRepository = loadCompatExport<any>([
      "src/annotations/infrastructure/annotation.repository",
    ], "AnnotationRepository");
    const legacyRepository = app.get<any>(AnnotationRepository);
    expect(legacyRepository.findByBook).toEqual(expect.any(Function));
    expect(legacyRepository.findByBook(1, 1)).toEqual([]);
  });
});
