export interface SessionRecord {
  id: string;
  userId: number;
  email: string;
  expiresAt: number;
  absoluteExpiresAt: number;
  renewedAt: number;
}
export interface SessionRepositoryPort {
  create(
    id: string,
    userId: number,
    tokenHash: string,
    now: number,
    expiresAt: number,
    absoluteExpiresAt: number,
  ): void;
  find(tokenHash: string, now: number): SessionRecord | null;
  renew(id: string, now: number, expiresAt: number): void;
  revoke(id: string): void;
  revokeUser(userId: number): void;
}
export const SESSION_REPOSITORY_PORT = Symbol("SESSION_REPOSITORY_PORT");
