import type { DoubanSettingsPort } from "./ports/douban-settings.port";

export interface DoubanConfigProjection {
  requestIntervalMs: number;
  cookie: string;
}

export class DoubanConfigService {
  constructor(
    private readonly settings: DoubanSettingsPort,
    private readonly requestIntervalMs: number,
  ) {}

  get(userId: number): DoubanConfigProjection {
    return {
      requestIntervalMs: this.requestIntervalMs,
      cookie: this.settings.getCookie(userId),
    };
  }

  update(userId: number, cookie: string | undefined): DoubanConfigProjection {
    if (cookie !== undefined) this.settings.upsertCookie(userId, cookie);
    return this.get(userId);
  }
}
