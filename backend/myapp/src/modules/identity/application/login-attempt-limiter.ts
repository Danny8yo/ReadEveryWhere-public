export interface LoginAttemptPolicy {
  /** 窗口内允许的失败次数，达到后锁定。 */
  maxFailures: number;
  windowMs: number;
  lockMs: number;
  /** 内存中最多跟踪的账号数，超出时淘汰最早记录，防止被大量随机邮箱撑爆内存。 */
  maxTrackedAccounts: number;
}

export const DEFAULT_LOGIN_ATTEMPT_POLICY: LoginAttemptPolicy = {
  maxFailures: 10,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
  maxTrackedAccounts: 10_000,
};

interface AttemptState {
  failures: number[];
  lockedUntil: number;
}

/**
 * 按账号（规范化邮箱）统计登录失败。Controller 上的按 IP 限流挡不住换 IP 对同一账号猜密码，
 * 这里补上账号维度。不存在的邮箱同样计数，锁定响应不暴露账号是否存在。
 * 状态在进程内存：后端为单副本部署，重启后清零可以接受。
 */
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, AttemptState>();

  constructor(
    private readonly policy: LoginAttemptPolicy = DEFAULT_LOGIN_ATTEMPT_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  /** 返回仍需等待的秒数；未锁定时为 0。 */
  lockedForSeconds(account: string): number {
    const state = this.attempts.get(account);
    if (!state) return 0;
    const remaining = state.lockedUntil - this.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(account: string): void {
    const now = this.now();
    const state = this.attempts.get(account) ?? { failures: [], lockedUntil: 0 };
    state.failures = state.failures.filter((at) => now - at < this.policy.windowMs);
    state.failures.push(now);
    if (state.failures.length >= this.policy.maxFailures) {
      state.lockedUntil = now + this.policy.lockMs;
      state.failures = [];
    }
    // 重新插入使其成为最新记录，淘汰时按 Map 插入顺序从最旧的开始。
    this.attempts.delete(account);
    this.attempts.set(account, state);
    this.evict(now);
  }

  recordSuccess(account: string): void {
    this.attempts.delete(account);
  }

  private evict(now: number): void {
    if (this.attempts.size <= this.policy.maxTrackedAccounts) return;
    for (const [account, state] of this.attempts) {
      const expired = state.lockedUntil <= now
        && state.failures.every((at) => now - at >= this.policy.windowMs);
      if (expired) this.attempts.delete(account);
    }
    for (const account of this.attempts.keys()) {
      if (this.attempts.size <= this.policy.maxTrackedAccounts) break;
      this.attempts.delete(account);
    }
  }
}
