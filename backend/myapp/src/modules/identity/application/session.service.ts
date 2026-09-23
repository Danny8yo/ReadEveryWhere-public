import type { SessionCredentialsPort } from "./ports/session-credentials.port";
import type {
  SessionRepositoryPort,
  SessionRecord,
} from "./ports/session-repository.port";
import { IdentityApplicationError } from "./identity-application.error";
export interface SessionPolicy {
  idleMs: number;
  absoluteMs: number;
  renewMs: number;
}
export function sessionPolicy(
  env: Record<string, string | undefined>,
): SessionPolicy {
  const number = (key: string, fallback: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || value > 315360000)
      throw new Error(
        `${key} must be a positive integer no greater than 315360000`,
      );
    return value * 1000;
  };
  const policy = {
    idleMs: number("SESSION_IDLE_TTL_SECONDS", 604800),
    absoluteMs: number("SESSION_ABSOLUTE_TTL_SECONDS", 2592000),
    renewMs: number("SESSION_RENEW_INTERVAL_SECONDS", 300),
  };
  if (policy.renewMs >= policy.idleMs || policy.idleMs > policy.absoluteMs)
    throw new Error("Session durations require renew < idle <= absolute");
  return policy;
}
export class SessionService {
  constructor(
    private readonly repository: SessionRepositoryPort,
    private readonly policy: SessionPolicy,
    private readonly credentials: SessionCredentialsPort,
    private readonly clock = Date.now,
  ) {}
  create(userId: number) {
    const now = this.clock();
    const { id, token } = this.credentials.generate();
    const absoluteExpiresAt = now + this.policy.absoluteMs;
    this.repository.create(
      id,
      userId,
      this.credentials.hash(token),
      now,
      Math.min(now + this.policy.idleMs, absoluteExpiresAt),
      absoluteExpiresAt,
    );
    return { token, absoluteExpiresAt };
  }
  authenticate(token: string): SessionRecord {
    if (!/^[A-Za-z0-9_-]{64}$/.test(token))
      throw IdentityApplicationError.unauthorized("Invalid session");
    const now = this.clock();
    const session = this.repository.find(this.credentials.hash(token), now);
    if (!session)
      throw IdentityApplicationError.unauthorized("Session expired or revoked");
    if (now - session.renewedAt >= this.policy.renewMs)
      this.repository.renew(
        session.id,
        now,
        Math.min(now + this.policy.idleMs, session.absoluteExpiresAt),
      );
    return session;
  }
  revoke(id: string) {
    this.repository.revoke(id);
  }
  revokeUser(userId: number) {
    this.repository.revokeUser(userId);
  }
}
