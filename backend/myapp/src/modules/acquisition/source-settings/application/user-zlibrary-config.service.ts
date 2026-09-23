import type { SourceLoginPort } from "../../public";
import type { SourceSettingsStorePort } from "./ports/source-settings-store.port";

export interface SaveZlibrarySettingsInput {
  email: string;
  password: string;
  baseUrl: string;
}

export interface ImportZlibraryCookiesInput {
  remixUserid: string;
  remixUserkey: string;
  baseUrl: string;
}

export interface ZlibrarySettingsProjection {
  hasStoredConfig: boolean;
  baseUrl: string | null;
  downloadsToday: number;
  downloadsLimit: number;
  isPremium: boolean;
  lastLoginAt: string | null;
  loginStatus: "pending" | "success" | "failed";
}

export class UserZlibraryConfigService {
  constructor(
    private readonly login: SourceLoginPort,
    private readonly store: SourceSettingsStorePort,
    private readonly defaultBaseUrl: string | null,
  ) {}

  async save(userId: number, input: SaveZlibrarySettingsInput): Promise<ZlibrarySettingsProjection> {
    const login = await this.login.loginWithCredentials(input.email, input.password, input.baseUrl);
    return this.saveValidatedCredentials(userId, input.baseUrl, login);
  }

  async saveCookies(
    userId: number,
    input: ImportZlibraryCookiesInput,
  ): Promise<ZlibrarySettingsProjection> {
    const login = await this.login.validateCookies(
      input.remixUserid,
      input.remixUserkey,
      input.baseUrl,
    );
    return this.saveValidatedCredentials(userId, input.baseUrl, login);
  }

  private saveValidatedCredentials(
    userId: number,
    baseUrl: string,
    login: Awaited<ReturnType<SourceLoginPort["loginWithCredentials"]>>,
  ): ZlibrarySettingsProjection {
    const now = new Date().toISOString();
    const saved = this.store.upsert(userId, {
      baseUrl,
      remixUserid: login.remix_userid,
      remixUserkey: login.remix_userkey,
      downloadsToday: login.downloads_today,
      downloadsLimit: login.downloads_limit,
      isPremium: login.is_premium,
      lastLoginAt: now,
      loginStatus: "success",
      loginError: null,
    });
    return projectSettings(saved, baseUrl);
  }

  updateBaseUrl(userId: number, baseUrl: string): { baseUrl: string } {
    this.store.updateBaseUrl(userId, baseUrl);
    return { baseUrl };
  }

  get(userId: number): ZlibrarySettingsProjection {
    const config = this.store.findByUserId(userId);
    if (!config) {
      return {
        hasStoredConfig: false,
        baseUrl: this.defaultBaseUrl,
        downloadsToday: 0,
        downloadsLimit: 10,
        isPremium: false,
        lastLoginAt: null,
        loginStatus: "pending",
      };
    }
    return projectSettings(config, config.baseUrl || this.defaultBaseUrl);
  }

  remove(userId: number): { deleted: boolean } {
    return { deleted: this.store.deleteByUserId(userId) };
  }
}

function projectSettings(
  config: {
    downloadsToday: number;
    downloadsLimit: number;
    isPremium: boolean;
    lastLoginAt: string | null;
    loginStatus: "pending" | "success" | "failed";
  },
  baseUrl: string | null,
): ZlibrarySettingsProjection {
  return {
    hasStoredConfig: true,
    baseUrl,
    downloadsToday: config.downloadsToday,
    downloadsLimit: config.downloadsLimit,
    isPremium: config.isPremium,
    lastLoginAt: config.lastLoginAt,
    loginStatus: config.loginStatus,
  };
}
