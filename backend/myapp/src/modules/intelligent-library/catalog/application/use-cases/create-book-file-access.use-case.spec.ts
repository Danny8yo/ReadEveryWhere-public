import { CreateBookFileAccessUseCase } from "./create-book-file-access.use-case";

describe("CreateBookFileAccessUseCase", () => {
  const originalEnv = process.env;
  const fixedNow = new Date("2026-07-03T00:00:00.000Z");

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(fixedNow);
    process.env = {
      ...originalEnv,
      JWT_SECRET: "library-file-access-test-secret",
    };
    delete process.env.BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS;
    delete process.env.BOOK_FILE_ACCESS_TOKEN_SECRET;
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
  });

  it("uses 2 hours as the default file access token TTL, rounded up to the next hour", () => {
    const useCase = new CreateBookFileAccessUseCase();

    const result = useCase.execute(1, 10);

    expect(new Date(result.expiresAt).getTime()).toBe(fixedNow.getTime() + 2 * 60 * 60 * 1000);
  });

  it("keeps BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS as the minimum lifetime", () => {
    process.env.BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS = "60";
    const useCase = new CreateBookFileAccessUseCase();

    const result = useCase.execute(1, 10);

    // TTL 是下限而不是精确值：过期时间按整点对齐，实际有效期在 TTL 到 TTL+1 小时之间。
    const expiresAt = new Date(result.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(fixedNow.getTime() + 60 * 1000);
    expect(expiresAt % (60 * 60 * 1000)).toBe(0);
  });

  it("returns a byte-identical URL for every mint inside the same hour", () => {
    process.env.BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS = "60";
    const useCase = new CreateBookFileAccessUseCase();

    const first = useCase.execute(1, 10);
    jest.setSystemTime(new Date(fixedNow.getTime() + 20 * 60 * 1000));
    const later = useCase.execute(1, 10);

    // token 在 query 里，URL 一变浏览器缓存的 key 就跟着变，同一本书每次打开都要重下。
    expect(later.url).toBe(first.url);
  });

  it("moves to a new URL once the hour rolls over", () => {
    process.env.BOOK_FILE_ACCESS_TOKEN_TTL_SECONDS = "60";
    const useCase = new CreateBookFileAccessUseCase();

    const first = useCase.execute(1, 10);
    jest.setSystemTime(new Date(fixedNow.getTime() + 61 * 60 * 1000));
    const nextWindow = useCase.execute(1, 10);

    expect(nextWindow.url).not.toBe(first.url);
  });
});
