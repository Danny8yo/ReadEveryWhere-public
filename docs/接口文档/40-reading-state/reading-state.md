# 在线阅读状态

全部接口默认需要 HttpOnly 服务端会话 Cookie。ReadingState 同步范围仅包含阅读进度、书签和批注；电子书文件不做跨设备同步。当前产品要求可用网络，不提供离线阅读、离线写入队列、后台重放、CRDT、持久化事件日志或删除墓碑。

创建批注、创建书签、写入进度、读取统一快照和建立事件流都会校验书籍归属。书籍不存在和不属于当前用户统一返回 `404 / 40401 / Book not found / details.field=book`。

## 统一快照 `/api/v1/reading-state`

`GET /api/v1/reading-state?bookId=42` 返回该用户、该书的服务端权威状态：

```json
{
  "revision": 18,
  "progress": null,
  "bookmarks": [],
  "annotations": []
}
```

`revision` 是 `(user_id, book_id)` 维度的统一状态版本。批注、书签或进度发生一次真实变更时递增；幂等书签创建、幂等删除、空更新和被设备序列拒绝的旧进度不会递增。业务表写入与统一 revision 在同一个 `BEGIN IMMEDIATE` 事务内提交，提交后才发布在线通知。

阅读器打开顺序为：加载并验证书籍文件，读取统一快照，按快照进度定位并渲染批注/书签，然后维持 SSE 连接。服务端快照失败时不使用浏览器旧进度继续定位。

## 在线变更流

`GET /api/v1/reading-state/stream?bookId=42&deviceId=<device-id>`，通过 HttpOnly Cookie 服务端会话鉴权，请求头使用 `Accept: text/event-stream`。

```text
event: reading_state_changed
data: {"bookId":42,"revision":19,"changed":["progress","annotations"]}
```

事件仅表示快照失效，不携带批注正文或完整状态。客户端收到比本地更新的 revision 后重新读取统一快照；窗口重新获得焦点和 SSE 重连成功时也强制刷新。服务端与书库共用 `platform/realtime/SseTransport`，由 better-sse 每 15 秒发送注释心跳，并新增 `ready` 空对象事件；`reading_state_changed` 及 deviceId 过滤语义不变。每次业务帧和心跳发送前复核会话有效性，失效关流；数据库异常记录并关流，重连请求暴露实际 HTTP 错误。慢消费者写缓冲需要 drain 或超过 64KiB 上限时关流，不积压无界队列。客户端以 Cookie 建连，ready/恢复后重新读取权威快照；选区 AI 问答流未迁移。

`deviceId` 用于过滤当前设备自己产生的进度事件；其他设备的新进度只更新“下次打开位置”，不会强制当前阅读器跳页。批注和书签变更仍刷新当前页面。断流后客户端按 1 秒起、最多 15 秒的指数退避重连。

事件总线当前是单 Nest 进程内实现，没有 Redis 和持久化事件日志。多进程部署前必须替换 EventBus Adapter；快照仍是唯一状态事实源。

## 批注 `/api/v1/annotations`

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/` | 创建高亮、下划线、波浪线或笔记；短时间同位置内容幂等 |
| PATCH | `/:id` | 携带 `revision` 更新颜色、类型或 note |
| GET | `/?bookId=...` | 按书列出，可按类型/是否有 note 过滤 |
| GET | `/commands/:commandId` | 查询当前用户原成功选区批注命令，不依赖对话/书籍/批注仍存在 |
| DELETE | `/:id?revision=...` | 携带 `revision` 硬删除 |

批注创建时 `revision=1`。PATCH 与 DELETE 都执行 CAS。目标不存在或不属于当前用户返回 404；revision 已变化返回 `409 / 40003`：

```json
{
  "code": 40003,
  "message": "Annotation was changed on another device",
  "details": {
    "field": "annotation",
    "reason": "ANNOTATION_CONFLICT",
    "current": { "id": "...", "revision": 4 }
  }
}
```

`details.current` 是服务器最新批注。前端保留用户原编辑内容，允许使用服务器版本，或基于最新 revision 重新编辑后保存，不自动覆盖。

旧 `/api/v1/annotations/sync` 已删除。在线同步通过 SSE 失效通知和统一全量快照传播创建、更新与硬删除，不保留 tombstone/cursor。

### 选区命令回执

`GET /api/v1/annotations/commands/:commandId` 返回统一响应信封；`data` 无成功回执时为 null，有回执时为 `{ receipt, currentAnnotation, replayed: true }`。`receipt` 含 `commandId`、原成功 `annotation` 完整快照、`readingStateVersion`、`createdAt`；`currentAnnotation` 是当前批注或 null，不覆盖原成功快照。只按登录用户和 commandId 读取，不能通过原书籍归属限制成功事实的恢复。

选区问答 apply 经专用内部命令写入，原 POST/PATCH/DELETE 保持不变。完整 apply 请求由调用方计算 SHA-256 摘要；命令相同而摘要不同返回 `ANNOTATION_COMMAND_CONFLICT`。同摘要重放先读回执，原对话/turn/批注/书籍删除、文件替换或批注继续修改都不会再次执行。新写入必须通过原选区精确回锚、revision CAS 和提交事务内 artifact fence；定位不符为 `ANNOTATION_SELECTION_INVALID`，annotation revision冲突携带最新 current。

## 书签 `/api/v1/bookmarks`

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/?bookId=...` | 获取单书书签 |
| POST | `/` | 创建书签，保存 location、fraction、chapterLabel |
| DELETE | `/:id` | 幂等硬删除 |

`(user_id, book_id, location)` 唯一。重复 POST 返回已存在的书签，不重复创建、不递增统一 revision。DELETE 对不存在或当前用户不可见的目标都返回 `{ deleted: true }`，真实删除才递增 revision 并发布事件。

## 阅读进度 `/api/v1/progress`

| 方法 | 路径 | 用途 |
|------|------|------|
| PUT | `/` | 按 `(userId, bookId)` 写入权威位置 |
| GET | `/?bookId=...` | 获取最新位置；专用限流 600 次/分钟 |

PUT 必须携带稳定设备 ID 和该设备单调递增的序列：

```json
{
  "bookId": 42,
  "location": "epubcfi(...)",
  "locationType": "epubcfi",
  "fraction": 0.42,
  "deviceId": "device-uuid",
  "deviceSequence": 187
}
```

`reading_progress` 每用户每书一行，每次接受新位置时自身 `revision` 递增。`reading_progress_devices` 保存每个设备最后接受的 sequence；同设备 `deviceSequence <= last_sequence` 时忽略请求并返回当前服务端进度，不覆盖位置、不递增任何 revision、不发布事件。不同设备按服务端实际接受顺序决定下次打开位置，不弹人工冲突框。

前端对 relocate 使用 rAF 合并和约 1 秒 debounce，切后台或卸载时立即 flush。请求处于同步中、成功或失败都有可见状态；失败不会回退到本地旧进度。旧响应也不能覆盖内存中的较新请求状态。

普通 POST /annotations 的短时重复保护要求位置、选文、note、annotationType、color 相同；5 秒内提交不同笔记不会返回旧笔记。持久 commandId 幂等仍只由选区应用命令承担。
