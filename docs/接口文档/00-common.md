# 通用约定

本文件说明 API 的全局响应结构、错误结构、错误码、鉴权方式和请求追踪规则。

- 基础路径：`/api/v1`
- 默认响应：成功响应由全局拦截器包装，异常由全局过滤器包装
- 鉴权：除明确标注为公开的接口外，均需 HttpOnly 会话 Cookie（Reader Tools 的 AI Token 除外）

## 1.1 响应格式

所有成功响应由全局拦截器统一包装为以下结构：

```json
{
  "code": 0,
  "message": "success",
  "data": { ... },
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-05-02T10:30:00.000Z"
}
```

**例外**：`GET /api/v1/library/books/:id/stream` 和 `GET /api/v1/library/books/:id/file` 返回二进制流，不经过此包装。

## 1.2 错误响应

所有异常由全局过滤器统一处理，返回以下结构：

```json
{
  "code": 40002,
  "message": "Parameter validation failed",
  "details": {
    "field": "title",
    "reason": "VALIDATION_ERROR"
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-05-02T10:30:00.000Z"
}
```

## 1.3 错误码

| 错误码 | HTTP 状态码 | 含义 |
|--------|-------------|------|
| 0 | 200/201 | 成功 |
| 40002 | 400 | 参数校验失败 |
| 40003 | 409 | 资源冲突（如重复添加书籍） |
| 40004 | 409 | 资源状态冲突（如取消已完成的任务） |
| 40101 | 401 | 未授权 / 会话无效或缺失 |
| 40301 | 403 | 已认证但不允许访问（例如 AI Token 调用未授权路由） |
| 40401 | 404 | 资源不存在 |
| 40402 | 404 | 资源状态不存在（如文件未下载或路径缺失） |
| 40403 | 404 | 物理资源不存在（如磁盘文件丢失） |
| 42901 | 429 | 登录失败次数过多，账号暂时锁定（见认证文档） |
| 50001 | 500 | 服务器内部错误 |
| 50002 | 502 | 上游服务不可用（如搜索源故障） |
| 50003 | 502 | 下载失败（CDN 不可达或返回空文件） |

## 1.4 鉴权

普通 Web 请求使用 `re_session` HttpOnly Cookie，浏览器携带 credentials。服务端校验持久会话并按活动续期，没有独立 access/refresh token。写请求（含公开认证操作）必须通过 Origin 校验；跨端口访问需在 CORS_ORIGIN 显式列出前端 origin。登录、恢复和撤销见 [认证与服务端会话](10-identity/auth.md)。Reader Tools 另允许带 scope 的 `Authorization: Bearer rew_ai_...`，其他业务接口不接受 AI Token。

## 1.5 请求追踪

支持在请求头中传入非空 `x-request-id` 用于全链路追踪。若未传入，Pino 请求层自动生成 UUID，并返回在响应头 `x-request-id` 及普通 JSON 响应体 `requestId` 中。

## 1.6 健康检查

```
GET /api/v1/health
```

公开接口，无需登录。Controller：`src/platform/health/health.controller.ts`，使用 Platform 的公开路由 metadata，不依赖 Identity 内部实现。

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok",
    "version": "a1b2c3d"
  },
  "requestId": "...",
  "timestamp": "..."
}
```

| 字段 | 说明 |
|------|------|
| `status` | 固定 `ok`；进程不可用时不会有响应 |
| `version` | 当前运行的构建版本，取自环境变量 `APP_VERSION`。由构建环境提供；本地开发通常为 `dev` |

`version` 供客户端辨认当前服务版本。

## 1.7 运行时能力探测

前端通过运行时接口读取会影响界面的服务能力，不硬编码配置值：

| 前端需要知道的事 | 探测接口 | 背后的环境变量 |
|------------------|----------|----------------|
| 公开注册是否开启（决定是否显示注册入口） | `GET /api/v1/auth/registration-status` | `REGISTRATION_ENABLED` |
| 单文件导入大小上限（决定选择器校验和提示文案） | `GET /api/v1/library/books/import-capabilities` | `IMPORT_MAX_FILE_SIZE_MB` |
| 当前线上跑的是哪个构建 | `GET /api/v1/health` 的 `data.version` | `APP_VERSION` |
| 当前用户的 Zlibrary 上游地址与配置状态 | `GET /api/v1/user/zlibrary-config` | `ZLIB_BASE_URL`（仅作未配置时的回退值） |

`registration-status` 与 `import-capabilities` 都返回 `Cache-Control: no-store`，前端不要缓存这两个响应。能力探测失败时应禁用对应入口，而不是回退到写死的默认值。

---
