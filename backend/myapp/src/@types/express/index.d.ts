import "express-serve-static-core";
import type { RequestPrincipal } from "../../modules/identity/public";

// 扩展 Express Request，挂载请求链路追踪字段。
declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    user?: RequestPrincipal;
  }
}

export {};
