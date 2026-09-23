import type { UserZlibraryConfig } from "../../domain/user-zlibrary-config.types";

export interface UpsertSourceSettingsInput {
  baseUrl: string;
  remixUserid: string;
  remixUserkey: string;
  downloadsToday: number;
  downloadsLimit: number;
  isPremium: boolean;
  loginStatus: "pending" | "success" | "failed";
  loginError?: string | null;
  lastLoginAt: string;
}

export interface SourceSettingsStorePort {
  findByUserId(userId: number): UserZlibraryConfig | null;
  upsert(userId: number, input: UpsertSourceSettingsInput): UserZlibraryConfig;
  updateBaseUrl(userId: number, baseUrl: string): void;
  markLoginFailed(userId: number, errorMessage: string): void;
  incrementDownloadsToday(userId: number): void;
  deleteByUserId(userId: number): boolean;
}

export const SOURCE_SETTINGS_STORE_PORT = Symbol("ACQUISITION_SOURCE_SETTINGS_STORE_PORT");
