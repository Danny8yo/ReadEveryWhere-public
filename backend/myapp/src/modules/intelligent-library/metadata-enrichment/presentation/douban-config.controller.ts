import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../../../platform/http/app-exception";
import { DoubanConfigService } from "../application/douban-config.service";
import { UpdateDoubanConfigDto } from "./dto/update-douban-config.dto";

interface DoubanConfig {
  requestIntervalMs: number;
  cookie: string;
}

/**
 * 豆瓣配置端点（一号一 Cookie）：
 * - Cookie 为每个用户独立的登录态，只能读写自己的（加密存储）。
 * - 请求间隔是服务端对豆瓣的全局限速闸门，与用户无关，
 *   仅由部署者通过 .env(DOUBAN_REQUEST_INTERVAL_MS) 配置，此处只读返回。
 */
@Controller("api/v1/metadata/douban-config")
export class DoubanConfigController {
  constructor(private readonly config: DoubanConfigService) {}

  @Get()
  get(@Req() req: Request): DoubanConfig {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    return this.config.get(userId);
  }

  @Patch()
  update(@Req() req: Request, @Body() dto: UpdateDoubanConfigDto): DoubanConfig {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    // dto.requestIntervalMs 被有意忽略：请求间隔是全局限速闸门，仅由 .env 管理。
    return this.config.update(userId, dto.cookie);
  }
}
