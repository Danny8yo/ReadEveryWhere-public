export const SESSION_VALIDITY_PORT = Symbol("SESSION_VALIDITY_PORT");
export interface SessionValidityPort {
  isActive(input: { sessionId: string; userId: number }): boolean;
}
