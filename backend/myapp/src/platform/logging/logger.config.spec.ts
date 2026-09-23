import { Writable } from "node:stream";
import pino from "pino";
import { createPinoHttpOptions } from "./logger.config";

describe("createPinoHttpOptions", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLogPretty = process.env.LOG_PRETTY;

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("LOG_PRETTY", originalLogPretty);
  });

  it("redacts an upstream reason while preserving safe diagnostic fields", () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_PRETTY = "false";

    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const options = createPinoHttpOptions();
    expect(Array.isArray(options)).toBe(false);

    const logger = pino(options as pino.LoggerOptions, destination);
    logger.warn({
      msg: {
        event: "exception.app",
        details: {
          reason: "UPSTREAM_UNAVAILABLE",
          upstream: {
            reason: "Wrong password: secret-password",
            status: 200,
            contentType: "text/html; charset=UTF-8",
            cfRay: "challenge-ray-LAX",
          },
        },
      },
    });

    const record = JSON.parse(output) as Record<string, any>;
    expect(record.msg.details.upstream.reason).toBe("[Redacted]");
    expect(record.msg.details.upstream).toMatchObject({
      status: 200,
      contentType: "text/html; charset=UTF-8",
      cfRay: "challenge-ray-LAX",
    });
    expect(output).not.toContain("secret-password");
  });

  it("redacts imported and deployment-level Zlibrary Cookie credentials", () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_PRETTY = "false";

    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const options = createPinoHttpOptions();
    const logger = pino(options as pino.LoggerOptions, destination);

    logger.warn({
      body: {
        remixUserid: "private-user-id",
        remixUserkey: "private-user-key",
      },
    });

    expect(output).not.toContain("private-user-id");
    expect(output).not.toContain("private-user-key");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
