export interface AuthUser {
  userId: number;
  email: string;
}
export interface AuthResponse {
  user: AuthUser;
}
export interface IssuedSession extends AuthResponse {
  token: string;
  absoluteExpiresAt: number;
}
