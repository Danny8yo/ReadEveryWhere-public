export interface PasswordPort {
  hash(password: string): Promise<string>;
  compare(password: string, passwordHash: string): Promise<boolean>;
}

export const PASSWORD_PORT = Symbol("IDENTITY_PASSWORD_PORT");
