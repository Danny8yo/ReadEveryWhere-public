import { firstValueFrom, throwError } from "rxjs";
import { AppException } from "../../../platform/http/app-exception";
import { AiReadingApplicationError } from "../application/application-error";
import { AiReadingApplicationErrorInterceptor } from "./ai-reading-application-error.interceptor";

describe("AiReadingApplicationErrorInterceptor", () => {
  it.each([
    ["not_found", 404, 40401],
    ["validation", 400, 40002],
    ["invalid_state", 409, 40004],
    ["conflict", 409, 40004],
    ["disabled", 404, 40401],
    ["unsupported_model", 400, 40002],
  ] as const)("maps %s without changing details", async (kind, status, code) => {
    const source = new AiReadingApplicationError(kind, "stable message", {
      field: "bookId",
      reason: "STABLE_REASON",
    });
    const interceptor = new AiReadingApplicationErrorInterceptor();

    await expect(firstValueFrom(interceptor.intercept({} as never, {
      handle: () => throwError(() => source),
    }))).rejects.toMatchObject({
      status,
      code,
      message: "stable message",
      details: { field: "bookId", reason: "STABLE_REASON" },
    });
  });

  it("leaves non-application errors unchanged", async () => {
    const source = new AppException(418, 49999, "passthrough", { reason: "PASSTHROUGH" });
    const interceptor = new AiReadingApplicationErrorInterceptor();

    await expect(firstValueFrom(interceptor.intercept({} as never, {
      handle: () => throwError(() => source),
    }))).rejects.toBe(source);
  });
});
