export interface IdentityUserRecord {
  id: number;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRepositoryPort {
  findByEmail(email: string): IdentityUserRecord | null;
  findById(id: number): IdentityUserRecord | null;
  create(email: string, passwordHash: string): IdentityUserRecord;
  updatePasswordHash(id: number, passwordHash: string): IdentityUserRecord;
}

export const USER_REPOSITORY_PORT = Symbol("IDENTITY_USER_REPOSITORY_PORT");
