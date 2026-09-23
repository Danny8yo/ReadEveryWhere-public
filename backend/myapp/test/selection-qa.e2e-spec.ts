import { execFile } from "node:child_process";
import { resolve } from "node:path";
describe("selection QA isolated production-runtime E2E", () => {
  it("passes all real runtime cases outside the TypeScript compiler heap", async () => {
    const result = await new Promise<string>((resolveResult, reject) => {
      const child = execFile(
        process.execPath,
        [
          "-r",
          "ts-node/register/transpile-only",
          resolve("test/selection-qa/runtime.runner.ts"),
        ],
        {
          cwd: process.cwd(),
          timeout: 90000,
          killSignal: "SIGKILL",
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          process.removeListener("exit", terminate);
          if (error)
            reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
          else resolveResult(stdout);
        },
      );
      const terminate = () => {
        child.kill("SIGKILL");
      };
      process.once("exit", terminate);
    });
    process.stdout.write(result);
    expect(result).toMatch(/(?:# |ℹ )fail 0/);
  }, 95000);
});
