import { DEV_SEED_EMAIL, DevAccountSeed, shouldSeedDevAccount } from "./dev-account-seed";

describe("DevAccountSeed", () => {
  const makeUsers = (existing: boolean) => ({
    findByEmail: jest.fn().mockReturnValue(existing ? { id: 1, email: DEV_SEED_EMAIL } : null),
    findById: jest.fn(),
    create: jest.fn().mockReturnValue({ id: 1, email: DEV_SEED_EMAIL }),
    updatePasswordHash: jest.fn(),
  });
  const passwords = { hash: jest.fn().mockResolvedValue("hashed"), compare: jest.fn() };
  const telemetry = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };

  it("defaults to local development only", () => {
    expect(shouldSeedDevAccount({})).toBe(true);
    expect(shouldSeedDevAccount({ NODE_ENV: "development" })).toBe(true);
    // 默认在生产种固定密码是安全事故；测试环境种了会让每个 e2e 用例的初始用户数漂移。
    expect(shouldSeedDevAccount({ NODE_ENV: "production" })).toBe(false);
    expect(shouldSeedDevAccount({ NODE_ENV: "test" })).toBe(false);
  });

  it("honours an explicit DEV_SEED_ACCOUNT switch in any environment", () => {
    expect(shouldSeedDevAccount({ NODE_ENV: "production", DEV_SEED_ACCOUNT: "true" })).toBe(true);
    expect(shouldSeedDevAccount({ NODE_ENV: "development", DEV_SEED_ACCOUNT: "false" })).toBe(false);
    expect(() => shouldSeedDevAccount({ DEV_SEED_ACCOUNT: "yes" })).toThrow(/true or false/u);
  });

  it("creates the account when it is missing", async () => {
    const users = makeUsers(false);
    await new DevAccountSeed(users, passwords, telemetry, true).onModuleInit();
    expect(users.create).toHaveBeenCalledWith(DEV_SEED_EMAIL, "hashed");
  });

  it("is idempotent across restarts", async () => {
    const users = makeUsers(true);
    await new DevAccountSeed(users, passwords, telemetry, true).onModuleInit();
    expect(users.create).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", async () => {
    const users = makeUsers(false);
    await new DevAccountSeed(users, passwords, telemetry, false).onModuleInit();
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });
});
