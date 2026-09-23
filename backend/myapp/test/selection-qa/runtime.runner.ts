import { describe, it, before, after } from "node:test";
import { expect } from "expect";
// No --test subprocess fan-out: all Nest work and worker threads belong to this child.
Object.assign(globalThis, {
  describe,
  it: (name: string, fn: () => Promise<void>) =>
    it(name, { timeout: 30000 }, fn),
  beforeAll: (fn: () => Promise<void>) => before(fn, { timeout: 30000 }),
  afterAll: (fn: () => Promise<void>) => after(fn, { timeout: 30000 }),
  expect,
});
require("./runtime-suite");
