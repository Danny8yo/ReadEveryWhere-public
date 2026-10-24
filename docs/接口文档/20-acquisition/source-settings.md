# Zlibrary 用户配置

本模块用于让用户通过账号登录或直接导入 Cookie 配置个人 Zlibrary 凭据和镜像域名，供下载流程获取可用 Cookie。

- 基础路径：`/api/v1/user/zlibrary-config`
- 鉴权：全部接口需登录
- 响应格式：遵循 [通用约定](../00-common.md)
- 安全边界：密码只用于透传登录，不写入数据库；Cookie 使用 `ENCRYPTION_KEY` 加密存储

账号登录和 Cookie 导入均由已移除的外部书源适配器执行。公开仓库保留本服务的请求与响应契约；密码不落库，Cookie 加密保存。

该能力位于 Acquisition 的 SourceSettings 切片；具体登录、Cookie 解释和远端请求位于 Zlibrary Integration。其他模块只能通过 `SourceSettingsQueryPort` 读取所需的 base URL，不访问配置 Repository 或明文 Cookie。

## 凭据优先级

下载请求发生时，只读取当前用户绑定的数据库 Cookie：

```
当前用户 DB Cookie（loginStatus=success）
```

凭据按用户绑定并使用 `ENCRYPTION_KEY` 加密保存，服务端读取时解密后随请求使用，不存在部署级 Cookie 回退。用户 Cookie 仅在下载接口明确返回 401/403 时标记 `loginStatus='failed'`。未配置任何可用 Cookie 时下载失败，前端可引导用户重新登录或导入 Cookie。

## 8.0 检测上游连通性

`POST /api/v1/user/zlibrary-config/discover-domains`

请求体为 `{ "baseUrl": "https://mirror.example" }`。后端由书源适配器从用户当前填写的 HTTPS origin 获取候选地址，并逐个匿名检测。返回候选地址、稳定分类、HTTP 状态和检测时间；只改变前端草稿，用户仍需显式选择并通过账号/Cookie 验证后才保存，不自动切换域名。

`POST /api/v1/user/zlibrary-config/probe`

请求体为 `{ "baseUrl": "https://mirror.example" }`。服务端经书源适配器发起一次匿名检测，不携带 Cookie、账号或密码，也不修改数据库。返回 `baseUrl`、`category`、`status` 和 `checkedAt`；分类包括 `API_REACHABLE`、`AUTH_REQUIRED`、`BOT_PROTECTION`、`UPSTREAM_FORBIDDEN`、`RATE_LIMITED`、`NETWORK_ERROR`、`TIMEOUT`、`INVALID_RESPONSE` 和 `UPSTREAM_HTTP_ERROR`。`API_REACHABLE` 只表示上游接口可达，不表示账号已验证。公开版未提供书源适配器，这两个接口不可用。

SSRF 约束（本组全部接口及下载共用）：`baseUrl` 必须是不含路径、query、fragment 和 userinfo 的 HTTPS origin，指向本机、私网、链路本地、云元数据、IPv4-mapped/NAT64 等保留地址的 IP 字面量直接返回 400。域名解析结果与每一跳重定向在建立连接时再次校验；命中禁止网段时请求不会发出，探测返回 `NETWORK_ERROR`，诊断中的 `errorCode` 为 `ERR_OUTBOUND_ADDRESS_BLOCKED`。上游请求不读取 `HTTP(S)_PROXY` 环境变量。若运行环境的代理使用 fake-ip DNS（域名解析到 `198.18.0.0/15`），真实解析由代理完成，域名解析到内网的拦截失效，只剩 IP 字面量校验。

## 8.1 配置/更新 Zlibrary 凭据

```
PUT /api/v1/user/zlibrary-config
```

需登录。向后端提供 Zlibrary 账号和镜像站地址，后端完成透传登录后将 Cookie 及账户元数据持久化，**密码不入库**。该接口每个已登录用户每小时最多调用 8 次。

**请求体**：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| email | string | 是 | 邮箱格式 | Zlibrary 登录邮箱 |
| password | string | 是 | 最少 1 位 | Zlibrary 登录密码（仅用于本次登录，不入库） |
| baseUrl | string | 是 | 最少 1 位 | 用户配置的 Zlibrary 上游域名（如 `https://zlibrary-mirror.example.com`） |

**成功响应 (200)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "baseUrl": "https://zlibrary-mirror.example.com",
    "hasStoredConfig": true,
    "downloadsToday": 0,
    "downloadsLimit": 10,
    "isPremium": false,
    "lastLoginAt": "2026-05-02T10:30:00.000Z",
    "loginStatus": "success"
  },
  "requestId": "...",
  "timestamp": "..."
}
```

## 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| hasStoredConfig | boolean | 当前用户是否存在数据库持久化配置；与部署级默认地址分开判断 |
| baseUrl | string \| null | 已配置的上游域名，未配置时为 null |
| downloadsToday | number | 当日已下载次数（跨天自动归零） |
| downloadsLimit | number | 每日下载上限 |
| isPremium | boolean | 是否为高级会员 |
| lastLoginAt | string \| null | 最近一次成功登录时间（ISO 8601） |
| loginStatus | string | `pending`（未配置）/ `success`（登录成功）/ `failed`（Cookie 失效） |

**注意**：响应中不包含 `remix_userid`、`remix_userkey`、`loginError` 等敏感或内部字段。

**错误场景**：

| 场景 | 错误码 | 说明 |
|------|--------|------|
| 参数校验失败 | 40002 | email 格式无效 / 必填字段缺失 |
| 网络错误（域名无法连接） | 50002 | 上游请求失败 |
| 上游 HTTP 错误 | 50002 | 上游 HTTP 错误 |
| 账号密码错误 | 50002 | 凭据被拒绝 |
| 响应缺少 Cookie | 50002 | 未取得有效凭据 |

失败日志不记录邮箱、密码、Cookie 或响应正文。

## 8.2 导入 Zlibrary Cookie

```
PUT /api/v1/user/zlibrary-config/cookies
```

需登录。适合从可信会话取得 Cookie 的用户。服务端通过书源适配器验证凭据及用户身份，成功后加密保存。

**请求体**：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| remixUserid | string | 是 | 1-256 位，不允许分号或 CR/LF | `remix_userid` Cookie 值 |
| remixUserkey | string | 是 | 1-256 位，不允许分号或 CR/LF | `remix_userkey` Cookie 值 |
| baseUrl | string | 是 | HTTPS URL | Cookie 所属的 Zlibrary 镜像地址 |

成功响应与 8.1 相同，且不会回显 Cookie。Cookie 校验失败返回 `50002`；参数非法在发起上游请求前返回 `40002`。该接口与只更新地址接口均限制为每分钟 10 次。

## 8.3 获取当前 Zlibrary 配置

```
GET /api/v1/user/zlibrary-config
```

需登录。返回当前用户的 Zlibrary 配置状态，**不包含敏感凭据**。

**成功响应 (200)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "baseUrl": "https://zlibrary-mirror.example.com",
    "hasStoredConfig": true,
    "downloadsToday": 2,
    "downloadsLimit": 10,
    "isPremium": false,
    "lastLoginAt": "2026-05-02T10:30:00.000Z",
    "loginStatus": "success"
  },
  "requestId": "...",
  "timestamp": "..."
}
```

未配置时返回默认值：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "baseUrl": null,
    "hasStoredConfig": false,
    "downloadsToday": 0,
    "downloadsLimit": 10,
    "isPremium": false,
    "lastLoginAt": null,
    "loginStatus": "pending"
  },
  "requestId": "...",
  "timestamp": "..."
}
```

未保存用户配置但部署环境设置了 `ZLIB_BASE_URL` 时，`baseUrl` 返回该默认地址，同时 `hasStoredConfig` 仍为 `false`。该环境变量仅提供上游地址，不提供任何 Cookie 凭据。

**特殊行为**：`downloadsToday` 在跨天后虚拟归零（数据库判断 `updated_at` 日期部分与今日不一致时返回 0），避免展示前一天的旧数据。

## 8.4 只更新上游地址

```
PATCH /api/v1/user/zlibrary-config/base-url
```

请求体为 `{ "baseUrl": "https://..." }`。后端先匿名检测，再使用当前已保存 Cookie 验证同一地址，成功后才更新地址；没有有效凭据时返回冲突。限制为每分钟 10 次。

只更新地址也会创建当前用户的持久化配置，因此后续 GET 返回 `hasStoredConfig: true`。

## 8.5 删除当前用户配置

```
DELETE /api/v1/user/zlibrary-config
```

需登录。删除当前用户整条 Zlibrary 配置，包括加密 Cookie、独立 Base URL、登录状态和下载计数。该操作不删除已经入库的书籍或已交付文件。

接口幂等：存在配置时返回 `deleted: true`，没有配置或重复删除时返回 `deleted: false`。

```json
{
  "code": 0,
  "message": "success",
  "data": { "deleted": true },
  "requestId": "...",
  "timestamp": "..."
}
```

删除后再次 GET 会返回 `hasStoredConfig: false`、`loginStatus: "pending"` 和清零后的用户统计；`baseUrl` 回退到部署级 `ZLIB_BASE_URL`，未设置时为 `null`。后续下载因没有当前用户 Cookie 而失败，需重新登录或导入 Cookie。

---
