# 认证与服务端会话

基础路径 `/api/v1/auth`。Identity 通过 SQLite 持久化服务端会话；普通网页登录不再签发 JWT 或 Refresh Token。成功响应仍使用统一信封，下表描述 data。

| 方法 | 路径 | 鉴权 | 请求 / 返回 |
|------|------|------|------|
| GET | `/registration-status` | 公开 | `{registrationEnabled:boolean}` |
| POST | `/register` | 公开；注册开关控制 | email/password/confirmPassword；返回 `{user:{userId,email}}` |
| POST | `/login` | 公开 | email/password；返回 `{user:{userId,email}}` |
| GET | `/session` | 会话 Cookie | 返回 `{user:{userId,email}}`，用于页面重载恢复 |
| POST | `/logout` | 会话 Cookie | 仅撤销当前会话并清除 Cookie |
| POST | `/reset-password` | 会话 Cookie | currentPassword/newPassword/confirmPassword；撤销该账号全部会话，为当前请求新建会话，返回 `{user:{userId,email}}` |

登录、注册及改密通过 `Set-Cookie` 设置 `re_session`：HttpOnly、SameSite=Lax、Path=/api、无 Domain（host-only）；有效期至会话绝对期限。`SESSION_COOKIE_SECURE=auto` 按受信任代理后的请求协议设置 Secure，也可显式配置 true/false；HTTP 局域网使用非 Secure，HTTPS 推荐显式 true。浏览器请求必须携带 credentials。Cookie 不含用户数据，数据库仅保存 48 随机字节凭证的 SHA-256 哈希。

默认空闲有效期 7 天、绝对有效期 30 天；有效请求距离上次续期超过 5 分钟时更新服务端空闲期限，永不越过绝对期限。凭证不轮转，不需要刷新接口，不会因并发或续期响应丢失使客户端持有过期版本。每个请求重新查库，撤销对后续请求立即生效；已经开始的文件流或 SSE 不会被倒退撤回。网络或数据库错误保持错误响应，不撤销会话。

所有认证响应不缓存。`GET /session` 与 `/registration-status` 不参与认证 Controller 的 10 分钟 5 次限流。其余认证操作保留原有节流。

所有写请求（包含登录和注册）必须携带 Origin，且等于请求自身 origin 或 `CORS_ORIGIN` 中显式配置的 origin；缺失、null、不可信 Origin 返回 403。无通配符授权。CORS 开启 credentials。AI Token 的只读 Bearer 链路保持独立。SameSite=Lax 不支持任意跨站 Cookie 嵌入；Web 推荐同源代理，局域网跨端口需要显式配置前端 origin。

公开注册由 `REGISTRATION_ENABLED` 控制，未配置时生产关闭、其他环境开启；只允许 true/false。关闭时注册 Guard 在 DTO 前返回 HTTP403/code40301/details.reason=REGISTRATION_DISABLED。

升级需前后端配套发布，旧客户端的 `/refresh` 和普通 Bearer JWT 不再支持。迁移 7 清除旧 Refresh Token 登录凭证，用户需重新登录一次；用户、密码、书籍和阅读记录均保留。

## AI Access Token

用于本地 `reader-tools-mcp`，不是普通网页登录 Token。**该节不属于 Web 前端登录流程**：这类 Token 只能访问 [Reader Tools](../90-internal/reader-tools.md)，前端不需要创建或持有它。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ai-tokens` | 创建；`name` 必填，`expiresInDays` 1-365，默认 90 |
| GET | `/ai-tokens` | 列出摘要，不返回 Token 明文 |
| DELETE | `/ai-tokens/:id` | 撤销 |

创建结果中的 `token` 只返回一次，前缀为 `rew_ai_`；数据库只保存哈希。当前固定 scope 为 `books:read` 与 `annotations:read`，仅允许访问标记了 `@AllowAiAccess()` 的 Reader Tools 路由。

## 常见错误

| 场景 | code |
|------|------|
| DTO 校验失败、两次密码不一致 | 40002 |
| 邮箱已注册 | 40003 |
| 公开注册已关闭 | 40301 / `REGISTRATION_DISABLED` |
| 登录失败、Token 无效或过期 | 40101 |
| AI Token 不存在或已撤销 | 40401 |
