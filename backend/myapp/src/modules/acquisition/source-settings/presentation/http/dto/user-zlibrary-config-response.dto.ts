export class UserZlibraryConfigResponse {
  hasStoredConfig: boolean;
  baseUrl: string | null;
  downloadsToday: number;
  downloadsLimit: number;
  isPremium: boolean;
  lastLoginAt: string | null;
  loginStatus: "pending" | "success" | "failed";

  constructor(config?: Partial<UserZlibraryConfigResponse>) {
    this.hasStoredConfig = config?.hasStoredConfig ?? false;
    this.baseUrl = config?.baseUrl ?? null;
    this.downloadsToday = config?.downloadsToday ?? 0;
    this.downloadsLimit = config?.downloadsLimit ?? 10;
    this.isPremium = config?.isPremium ?? false;
    this.lastLoginAt = config?.lastLoginAt ?? null;
    this.loginStatus = config?.loginStatus ?? "pending";
  }
}
