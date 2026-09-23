import { Body, Controller, Delete, Get, Patch, Put, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { AppException } from "../../../../../platform/http/app-exception";
import { assertSafeOutboundUrl } from "../../../../../platform/security/url-guard";
import { UserZlibraryConfigService } from "../../application/user-zlibrary-config.service";
import { ImportZlibraryCookiesDto } from "./dto/import-zlibrary-cookies.dto";
import { SaveZlibraryConfigDto } from "./dto/save-zlibrary-config.dto";
import { UpdateBaseUrlDto } from "./dto/update-base-url.dto";

@Controller("api/v1/user/zlibrary-config")
export class UserZlibraryConfigController {
  constructor(
    private readonly userZlibraryConfigService: UserZlibraryConfigService,
  ) {}

  // 上游约按 IP 限制每小时 10 次登录；本服务保留两次余量。
  @Throttle({ default: { limit: 8, ttl: 3600000 } })
  @Put()
  async save(@Req() req: Request, @Body() dto: SaveZlibraryConfigDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    const baseUrl = safeBaseUrl(dto.baseUrl);
    return this.userZlibraryConfigService.save(userId, { ...dto, baseUrl });
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Put("cookies")
  async importCookies(@Req() req: Request, @Body() dto: ImportZlibraryCookiesDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    const baseUrl = safeBaseUrl(dto.baseUrl);
    return this.userZlibraryConfigService.saveCookies(userId, { ...dto, baseUrl });
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch("base-url")
  updateBaseUrl(@Req() req: Request, @Body() dto: UpdateBaseUrlDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    return this.userZlibraryConfigService.updateBaseUrl(userId, safeBaseUrl(dto.baseUrl));
  }

  @Get()
  get(@Req() req: Request) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    return this.userZlibraryConfigService.get(userId);
  }

  @Delete()
  remove(@Req() req: Request) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    return this.userZlibraryConfigService.remove(userId);
  }
}

function safeBaseUrl(value: string): string {
  return assertSafeOutboundUrl(value, { field: "baseUrl", httpsOnly: true }).replace(/\/+$/, "");
}
