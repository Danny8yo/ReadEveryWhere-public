import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PublicRoute } from "../http/public-route";

/**
 * 健康检查控制器：用于探活与服务连通性检查。
 */
@Controller("api/v1")
@SkipThrottle()
export class HealthController {
  /**
   * 返回基础健康状态与当前构建版本。
   *
   * version 由镜像构建时的 APP_VERSION 烘入（CI 传入短 commit sha），
   * 部署脚本用它确认线上跑的确实是刚推上去的那个构建；本地开发时为 "dev"。
   */
  @PublicRoute()
  @Get("health")
  check() {
    return {
      status: "ok",
      version: process.env.APP_VERSION ?? "dev",
    };
  }
}
