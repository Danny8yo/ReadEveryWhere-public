import { Test, TestingModule } from "@nestjs/testing";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { StorageService } from "../../../../platform/storage/storage.service";
import { SqliteLibraryReadModelQuery } from "../../library-queries/infrastructure/sqlite-library-read-model.query";
import { SqliteBookFileStreamingQuery } from "./persistence/sqlite/sqlite-book-file-streaming.query";

describe("SQLite query adapters", () => {
  let library: SqliteLibraryReadModelQuery;
  let streaming: SqliteBookFileStreamingQuery;
  let sqliteService: SqliteService;
  let storageService: { resolvePath: jest.Mock };

  beforeAll(async () => {
    storageService = { resolvePath: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqliteLibraryReadModelQuery,
        SqliteBookFileStreamingQuery,
        { provide: SqliteService, useValue: { getDatabase: jest.fn() } },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    library = module.get(SqliteLibraryReadModelQuery);
    streaming = module.get(SqliteBookFileStreamingQuery);
    sqliteService = module.get(SqliteService);
  });

  it("maps PDF mimeType in the library read model", () => {
    const mockDatabase = {
      prepare: jest.fn().mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            id: 1, user_id: 1, title: "Test PDF", authors_json: "[]",
            authors_text: "", isbn: null, cover_url: null, description: null,
            publisher: null, source_platform: "manual", source_book_id: null,
            source_url: null, publish_year: null, edition_tag: null,
            version: 1,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            file_name: "test.pdf", stored_path: "1/test.pdf",
            download_task_status: "completed", download_progress: 100, checksum: null,
            mime_type: "application/pdf", file_size: 4096,
            profile_id: "profile-1", primary_genre: null,
            secondary_genres_json: "[]", traits_json: "[]",
            confidence_kind: null, confidence_score: null,
            classification_summary: null, profile_version: 1,
            profile_updated_at: "2026-01-01T00:00:00.000Z",
          },
        ]),
        get: jest.fn().mockReturnValue({ total: 1 }),
      }),
    };
    (sqliteService.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const result = library.listBooks({ userId: 1, page: 1, pageSize: 20 });

    expect(result.items[0].mimeType).toBe("application/pdf");
    expect(result.items[0].fileSize).toBe(4096);
  });

  it("maps a missing current artifact pointer to a null mimeType", () => {
    const mockDatabase = {
      prepare: jest.fn().mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            id: 2, user_id: 1, title: "Manual Book", authors_json: "[]",
            authors_text: "", isbn: null, cover_url: null, description: null,
            publisher: null, source_platform: "manual", source_book_id: null,
            source_url: null, publish_year: null, edition_tag: null,
            version: 1,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            file_name: null, stored_path: null,
            download_task_status: null, download_progress: null, checksum: null,
            mime_type: null, file_size: null,
            profile_id: "profile-2", primary_genre: null,
            secondary_genres_json: "[]", traits_json: "[]",
            confidence_kind: null, confidence_score: null,
            classification_summary: null, profile_version: 1,
            profile_updated_at: "2026-01-01T00:00:00.000Z",
          },
        ]),
        get: jest.fn().mockReturnValue({ total: 1 }),
      }),
    };
    (sqliteService.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const result = library.listBooks({ userId: 1, page: 1, pageSize: 20 });

    expect(result.items[0].mimeType).toBeNull();
    expect(result.items[0].fileSize).toBeNull();
  });

  it("fails when a Book has no formal reading profile", () => {
    const mockDatabase = {
      prepare: jest.fn().mockReturnValue({
        all: jest.fn().mockReturnValue([{
          id: 3, user_id: 1, title: "Corrupt Book", authors_json: "[]",
          authors_text: "", isbn: null, cover_url: null, description: null,
          publisher: null, source_platform: "manual", source_book_id: null,
          source_url: null, publish_year: null, edition_tag: null,
          version: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          file_name: null, stored_path: null, download_task_status: null, download_progress: null,
          checksum: null, mime_type: null, profile_id: null,
        }]),
        get: jest.fn().mockReturnValue({ total: 1 }),
      }),
    };
    (sqliteService.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    expect(() => library.listBooks({ userId: 1, page: 1, pageSize: 20 }))
      .toThrow("Book 3 is missing its reading profile");
  });

  it("returns null when no current artifact exists", () => {
    const mockDatabase = {
      prepare: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue(undefined),
      }),
    };
    (sqliteService.getDatabase as jest.Mock).mockReturnValue(mockDatabase);
    expect(streaming.findForStreaming({ userId: 1, bookId: 42 })).toBeNull();
  });
});
