import { registrationEnabledFromEnvironment } from "./registration-policy";

describe("registrationEnabledFromEnvironment", () => {
  it("defaults to enabled outside production", () => {
    expect(registrationEnabledFromEnvironment({ NODE_ENV: "development" })).toBe(true);
    expect(registrationEnabledFromEnvironment({ NODE_ENV: "test" })).toBe(true);
  });

  it("defaults to disabled in production", () => {
    expect(registrationEnabledFromEnvironment({ NODE_ENV: "production" })).toBe(false);
  });

  it("honors explicit true and false values", () => {
    expect(registrationEnabledFromEnvironment({ NODE_ENV: "production", REGISTRATION_ENABLED: "true" })).toBe(true);
    expect(registrationEnabledFromEnvironment({ NODE_ENV: "development", REGISTRATION_ENABLED: "false" })).toBe(false);
  });

  it.each(["TRUE", "False", "1", "yes", ""])("rejects invalid value %p", (value) => {
    expect(() => registrationEnabledFromEnvironment({ REGISTRATION_ENABLED: value })).toThrow(
      "REGISTRATION_ENABLED must be either true or false",
    );
  });
});
