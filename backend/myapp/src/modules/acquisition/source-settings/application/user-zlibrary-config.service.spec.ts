import type { SourceLoginPort } from "../../public";
import type { UserZlibraryConfig } from "../domain/user-zlibrary-config.types";
import type { SourceSettingsStorePort } from "./ports/source-settings-store.port";
import { UserZlibraryConfigService } from "./user-zlibrary-config.service";

describe("UserZlibraryConfigService", () => {
  const login: jest.Mocked<SourceLoginPort> = {
    loginWithCredentials: jest.fn(),
    validateCookies: jest.fn(),
  };
  const store: jest.Mocked<SourceSettingsStorePort> = {
    findByUserId: jest.fn(),
    upsert: jest.fn(),
    updateBaseUrl: jest.fn(),
    markLoginFailed: jest.fn(),
    incrementDownloadsToday: jest.fn(),
    deleteByUserId: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it("区分部署默认地址与用户持久化配置", () => {
    store.findByUserId.mockReturnValue(null);
    const service = new UserZlibraryConfigService(login, store, "https://default.example");

    expect(service.get(7)).toMatchObject({
      hasStoredConfig: false,
      baseUrl: "https://default.example",
      loginStatus: "pending",
    });
  });

  it("即使只保存地址也标记为持久化配置", () => {
    store.findByUserId.mockReturnValue(savedConfig({
      baseUrl: "https://stored.example",
      loginStatus: "pending",
    }));
    const service = new UserZlibraryConfigService(login, store, "https://default.example");

    expect(service.get(7)).toMatchObject({
      hasStoredConfig: true,
      baseUrl: "https://stored.example",
      loginStatus: "pending",
    });
  });

  it("返回 Repository 的真实删除状态以支持幂等调用", () => {
    store.deleteByUserId.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const service = new UserZlibraryConfigService(login, store, null);

    expect(service.remove(7)).toEqual({ deleted: true });
    expect(service.remove(7)).toEqual({ deleted: false });
    expect(store.deleteByUserId).toHaveBeenNthCalledWith(1, 7);
    expect(store.deleteByUserId).toHaveBeenNthCalledWith(2, 7);
  });

  it("验证并保存用户导入的 Cookie 凭据", async () => {
    login.validateCookies.mockResolvedValue({
      remix_userid: "40432371",
      remix_userkey: "private-remix-key",
      downloads_today: 2,
      downloads_limit: 10,
      is_premium: true,
    });
    store.upsert.mockImplementation((userId, input) => savedConfig({
      userId,
      baseUrl: input.baseUrl,
      remixUserid: input.remixUserid,
      remixUserkey: input.remixUserkey,
      downloadsToday: input.downloadsToday,
      downloadsLimit: input.downloadsLimit,
      isPremium: input.isPremium,
      loginStatus: input.loginStatus,
      lastLoginAt: input.lastLoginAt,
    }));
    const service = new UserZlibraryConfigService(login, store, null);

    const result = await service.saveCookies(7, {
      remixUserid: "40432371",
      remixUserkey: "private-remix-key",
      baseUrl: "https://mirror.example",
    });

    expect(login.validateCookies).toHaveBeenCalledWith(
      "40432371",
      "private-remix-key",
      "https://mirror.example",
    );
    expect(store.upsert).toHaveBeenCalledWith(7, expect.objectContaining({
      remixUserid: "40432371",
      remixUserkey: "private-remix-key",
      loginStatus: "success",
    }));
    expect(result).toMatchObject({
      hasStoredConfig: true,
      loginStatus: "success",
      downloadsToday: 2,
      downloadsLimit: 10,
      isPremium: true,
    });
  });
});

function savedConfig(overrides: Partial<UserZlibraryConfig> = {}): UserZlibraryConfig {
  return {
    id: 1,
    userId: 7,
    baseUrl: "https://stored.example",
    remixUserid: "",
    remixUserkey: "",
    downloadsToday: 0,
    downloadsLimit: 10,
    isPremium: false,
    isActive: true,
    lastLoginAt: null,
    loginStatus: "pending",
    loginError: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}
