export interface AuthUser {
    userId: number;
    email: string;
}
export interface AuthResponse {
    user: AuthUser;
}
export interface RegistrationStatus {
    registrationEnabled: boolean;
}

export interface AuthSessionData {
  user: AuthUser;
}
