import { LoginAttemptLimiter } from "./login-attempt-limiter";

describe("LoginAttemptLimiter", () => {
  let now = 0;
  const policy = { maxFailures: 3, windowMs: 60_000, lockMs: 120_000, maxTrackedAccounts: 2 };
  const limiter = () => new LoginAttemptLimiter(policy, () => now);

  beforeEach(() => {
    now = 1_000_000;
  });

  it("locks after the failure threshold within the window and unlocks after lockMs", () => {
    const attempts = limiter();
    attempts.recordFailure("a@example.com");
    attempts.recordFailure("a@example.com");
    expect(attempts.lockedForSeconds("a@example.com")).toBe(0);

    attempts.recordFailure("a@example.com");
    expect(attempts.lockedForSeconds("a@example.com")).toBe(120);

    now += 119_001;
    expect(attempts.lockedForSeconds("a@example.com")).toBe(1);
    now += 1_000;
    expect(attempts.lockedForSeconds("a@example.com")).toBe(0);
  });

  it("forgets failures that fall outside the window", () => {
    const attempts = limiter();
    attempts.recordFailure("a@example.com");
    attempts.recordFailure("a@example.com");
    now += 60_000;
    attempts.recordFailure("a@example.com");
    expect(attempts.lockedForSeconds("a@example.com")).toBe(0);
  });

  it("clears the counter on success", () => {
    const attempts = limiter();
    attempts.recordFailure("a@example.com");
    attempts.recordFailure("a@example.com");
    attempts.recordSuccess("a@example.com");
    attempts.recordFailure("a@example.com");
    attempts.recordFailure("a@example.com");
    expect(attempts.lockedForSeconds("a@example.com")).toBe(0);
  });

  it("bounds memory by evicting the oldest tracked accounts", () => {
    const attempts = limiter();
    for (let i = 0; i < 3; i += 1) attempts.recordFailure("old@example.com");
    attempts.recordFailure("b@example.com");
    attempts.recordFailure("c@example.com");
    expect(attempts.lockedForSeconds("old@example.com")).toBe(0);
  });
});
