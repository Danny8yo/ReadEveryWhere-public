export interface SessionCredentialsPort {
  generate(): { id: string; token: string };
  hash(token: string): string;
}
export const SESSION_CREDENTIALS_PORT = Symbol("SESSION_CREDENTIALS_PORT");
