export interface DoubanSettingsPort {
  getCookie(userId: number): string;
  upsertCookie(userId: number, cookie: string): void;
}

export const DOUBAN_SETTINGS_PORT = Symbol(
  "INTELLIGENT_LIBRARY_DOUBAN_SETTINGS_PORT",
);
