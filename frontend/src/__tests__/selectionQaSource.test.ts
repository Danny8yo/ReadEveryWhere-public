import { describe, it, expect, vi, afterEach } from "vitest";
import { webcrypto, createHash } from "node:crypto";
import { createReaderSourceLoader } from "../features/reader/web/sourceLoader";
import { createBookFileAccessUrl } from "../features/library/api/libraryApi";
import { fetchWithAuth } from "../services/apiClient";
import { getCachedBookFile, putCachedBookFile } from "../services/bookFileCache";
vi.mock("../services/bookFileCache", () => ({
  buildBookFileCacheKey: (d: { userId: number; bookId: number; checksum: string }) => `${d.userId}:${d.bookId}:${d.checksum}`,
  getCachedBookFile: vi.fn(),
  putCachedBookFile: vi.fn(),
}));
vi.mock("../features/library/api/libraryApi", () => ({
  createBookFileAccessUrl: vi.fn(),
}));
vi.mock("../services/apiClient", () => ({ fetchWithAuth: vi.fn(), resolveBackendUrl: (url: string) => url }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const input = {
  bookId: 1,
  userId: 1,
  fileName: "test.epub",
  mimeType: "application/epub+zip",
  checksum: "untrusted-property",
  updatedAt: "now",
  version: 1,
};
describe("actual EPUB byte identity", () => {
  it("hashes the exact cached File once rather than trusting book metadata", async () => {
    const file = new File(["actual epub bytes"], "test.epub");
    vi.mocked(getCachedBookFile).mockResolvedValue(file);
    const digest = vi.fn(webcrypto.subtle.digest.bind(webcrypto.subtle));
    vi.stubGlobal("crypto", { subtle: { digest } });
    const source = await createReaderSourceLoader(
      input,
      () => {},
    ).loadReaderSource();
    expect(source.kind).toBe("file");
    if (source.kind !== "file") throw new Error("file expected");
    expect(source.file).toBe(file);
    expect(source.epubIdentity?.fileChecksum).toBe(
      "sha256:" +
        createHash("sha256").update("actual epub bytes").digest("hex"),
    );
    expect(digest).toHaveBeenCalledTimes(1);
  });
  it("keeps ordinary EPUB reading available without WebCrypto and gives a visible QA reason", async () => {
    const file = new File(["epub"], "test.epub");
    vi.mocked(getCachedBookFile).mockResolvedValue(file);
    vi.stubGlobal("crypto", {});
    const source = await createReaderSourceLoader(
      input,
      () => {},
    ).loadReaderSource();
    if (source.kind !== "file") throw new Error("file expected");
    expect(source.file).toBe(file);
    expect(source.epubIdentity).toBeUndefined();
    expect(source.qaUnavailableReason).toContain("选区问答不可用");
  });
});


it('continues downloading after reader detaches and shares it with the next reader', async () => {
  vi.mocked(getCachedBookFile).mockResolvedValue(null);
  vi.mocked(createBookFileAccessUrl).mockResolvedValue({ url: '/file' } as Awaited<ReturnType<typeof createBookFileAccessUrl>>);
  let finish!: (response: Response) => void;
  vi.mocked(fetchWithAuth).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = createReaderSourceLoader(input, () => {});
  const loading = first.loadReaderSource();
  const detached = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(1));
  first.detach();
  const second = createReaderSourceLoader(input, () => {}).loadReaderSource();
  finish(new Response('complete epub bytes'));
  await detached;
  const source = await second;
  expect(source.kind).toBe('file');
  if (source.kind !== 'file') throw new Error('expected file');
  expect(await source.file.text()).toBe('complete epub bytes');
  expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  expect(putCachedBookFile).toHaveBeenCalledTimes(1);
});

it('expired signed file URLs do not invalidate the user session or write cache', async () => {
  vi.mocked(getCachedBookFile).mockResolvedValue(null);
  vi.mocked(createBookFileAccessUrl).mockResolvedValue({ url: '/file?token=expired' } as Awaited<ReturnType<typeof createBookFileAccessUrl>>);
  vi.mocked(fetchWithAuth).mockResolvedValue(new Response('', { status: 401 }));
  await expect(createReaderSourceLoader(input, () => {}).loadReaderSource()).rejects.toThrow('文件访问链接已失效');
  expect(fetchWithAuth).toHaveBeenCalledWith('/file?token=expired', {}, false);
  expect(putCachedBookFile).not.toHaveBeenCalled();
});
