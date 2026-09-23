import { parseJsonStringArray } from "./library.utils";

describe("library JSON persistence values", () => {
  it("rejects malformed JSON instead of treating it as an empty array", () => {
    expect(() => parseJsonStringArray("not-json", "authors_json"))
      .toThrow("authors_json must be a JSON array of strings");
  });

  it("rejects arrays containing non-string values", () => {
    expect(() => parseJsonStringArray('["Author", 1]', "authors_json"))
      .toThrow("authors_json must be a JSON array of strings");
  });
});
