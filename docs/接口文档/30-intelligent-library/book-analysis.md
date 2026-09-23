# 书籍 AI 预分析

本模块在启动 AI 自主阅读前生成并持久化 `BookReadingProfileCandidate`。它只分析用户私有书架中的 EPUB，读取元数据、目录、内容统计，并在信息不足时有界读取少量代表性正文；不会直接修改 Catalog 的正式阅读画像、原文、基础元数据或批注。

- 基础路径：`/api/v1/book-analysis`
- 鉴权：所有接口均需 HttpOnly 会话 Cookie
- 响应格式：遵循 [通用约定](../00-common.md)
- 当前策略版本：`book-profile-v1`
- 当前批量上限：50 个 ID
- worker 并发：默认 1，可通过 `BOOK_ANALYSIS_CONCURRENCY` 配置为 1-4
- 当前代码：`src/modules/intelligent-library/book-analysis/`；BookAnalysis 的归属和 metadata 输入来自 Catalog `CatalogBookViewQueryPort` 的只读 View，文件输入来自 `BookContentCatalogPort`/`BookDocumentLoader`，不会为分析查询加载写聚合或全部 `source_refs`。AiReading Infrastructure Adapter 经 IntelligentLibrary `public/BookReadingProfileAccessPort` 获取 Catalog 正式画像准入投影，再转换为 AiReading 自有 Application Port

## 11.1 状态与有效性

| status | 含义 | candidate |
|--------|------|---------|
| `not_analyzed` | 当前没有画像或可分析文件 | null |
| `pending` | 已入队，等待 worker | null |
| `running` | worker 正在分类 | null |
| `ready` | 当前内容 revision 与当前策略版本存在有效画像 | 完整画像 |
| `failed` | 当前 revision 的最近任务失败 | null，`errorCode` 有值 |
| `stale` | 有历史画像，但与当前内容 revision 或策略版本不匹配 | null |
| `unsupported` | 本地文件不是 EPUB | null |

“已分析”只表示当前 `contentRevision + strategyVersion` 有有效画像。历史上成功过但内容或策略已变化，仍为 `stale`，必须重新分析。

`ContentRevision` 结构：

```json
{
  "fileChecksum": "sha256:...",
  "extractorVersion": "epub-extractor-v4",
  "normalizationVersion": "epub-text-v1"
}
```

## 11.2 请求单书分析

```
POST /api/v1/book-analysis/books/:bookId
```

**请求体**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| force | boolean | 否 | false | true 时即使已有当前 ready 画像也创建新任务 |

**已受理响应 (201)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "bookId": 42,
    "disposition": "accepted",
    "status": "pending",
    "taskId": "ed50f7e1-...",
    "reason": null
  },
  "requestId": "...",
  "timestamp": "..."
}
```

**幂等跳过响应 (201)**：

| 场景 | disposition | status | taskId | reason |
|------|-------------|--------|--------|--------|
| 当前 ready 且 `force=false` | `skipped` | `ready` | null | `ANALYSIS_CURRENT` |
| 相同书籍、revision、策略已有 pending/running 任务 | `skipped` | `pending` 或 `running` | 已有任务 ID | `ALREADY_QUEUED` |

`force=true` 会绕过 ready 跳过逻辑，但不会创建第二个相同活动任务；若已有 pending/running，仍返回 `ALREADY_QUEUED`。

**请求拒绝**：

| HTTP / code | details.reason | 说明 |
|-------------|----------------|------|
| 404 / 40401 | `BOOK_NOT_FOUND` | 书籍不存在或不属于当前用户 |
| 409 / 40004 | `BOOK_FILE_MISSING` | 没有本地文件或下载未完成 |
| 409 / 40004 | `UNSUPPORTED_FORMAT` | 当前只支持 EPUB |
| 409 / 40004 | `AI_MODEL_NOT_CONFIGURED` | 用户未配置 AI API Key |
| 409 / 40004 | `AI_MODEL_UNSUPPORTED` | 当前配置为不支持 strict Tool calling 的 reasoning 模型 |

## 11.3 批量请求分析

```
POST /api/v1/book-analysis/batch
```

**请求体**：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
|------|------|------|--------|------|
| bookIds | number[] | 是 | - | 1-50 项，每项为大于等于 1 的整数 |
| force | boolean | 否 | false | 语义同单书接口 |

请求中的重复 ID 会按首次出现顺序去重。某一本失败不会使整个批次失败；每个去重后的 ID 返回一项结果。

**混合结果响应 (201)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "bookId": 42,
        "disposition": "accepted",
        "status": "pending",
        "taskId": "ed50f7e1-...",
        "reason": null
      },
      {
        "bookId": 43,
        "disposition": "skipped",
        "status": "ready",
        "taskId": null,
        "reason": "ANALYSIS_CURRENT"
      },
      {
        "bookId": 44,
        "disposition": "rejected",
        "status": "not_analyzed",
        "taskId": null,
        "reason": "BOOK_FILE_MISSING"
      }
    ]
  },
  "requestId": "...",
  "timestamp": "..."
}
```

`disposition` 只描述本次请求处理结果：

| disposition | 含义 |
|-------------|------|
| `accepted` | 新任务已创建 |
| `skipped` | 已有有效画像或相同活动任务 |
| `rejected` | 当前书籍不能入队；原因见 `reason` |

`rejected` item 的 `status` 固定为 `not_analyzed`，`taskId` 为 null。`rejected.reason` 使用单书请求的原因，包括 `BOOK_NOT_FOUND`、`BOOK_FILE_MISSING`、`UNSUPPORTED_FORMAT`、`AI_MODEL_NOT_CONFIGURED`、`AI_MODEL_UNSUPPORTED`。`bookIds` 为空、超过 50、含非整数或小于 1 的值时，整个请求返回 `400 / code 40002`。

## 11.4 查询单书分析

分析成功后的 `candidate` 是待确认候选。调用 `POST /api/v1/book-analysis/books/:bookId/apply`，请求体 `{ "candidateId": "candidate-...", "override": false }` 应用候选；`override: true` 表示明确覆盖当前人工画像。两者都拒绝内容 revision 已变化或非 pending 候选。应用经 Catalog Application Port 进入 Book 聚合，候选条件消费和 BookRepository 保存位于同一 SQLite 写事务中。

当前 revision/策略下，`pending` 和已确认的 `applied` 候选都表示分析状态 `ready`。候选响应带有 `status`：`pending` 仍可供用户确认，`applied` 仅用于展示已完成分析，不能再次应用；书架摘要不会为 `applied` 候选提供可重复应用的 `candidateId`。正式画像仍由 `book_profiles` 保存，人工清空画像不会删除分析历史，但 AI 阅读仍要求正式画像有效。

```
GET /api/v1/book-analysis/books/:bookId
```

需登录且只能查询自己的书。该轮询入口限流为每用户每分钟 6000 次。

**未分析响应 (200)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "bookId": 42,
    "status": "not_analyzed",
    "stale": false,
    "candidate": null,
    "errorCode": null
  },
  "requestId": "...",
  "timestamp": "..."
}
```

**ready 响应 (200)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "bookId": 42,
    "status": "ready",
    "stale": false,
    "candidate": {
      "id": "profile-...",
      "userId": 1,
      "bookId": 42,
      "baseProfileVersion": 1,
      "status": "pending",
      "primaryGenre": "technical",
      "secondaryGenres": ["popular-science"],
      "traits": ["章节化", "概念驱动"],
      "confidence": 0.93,
      "classificationSummary": "目录按概念递进，并包含明确的方法与实践章节。",
      "contentRevision": {
        "fileChecksum": "sha256:...",
        "extractorVersion": "epub-extractor-v4",
        "normalizationVersion": "epub-text-v1"
      },
      "modelId": "deepseek-v4-flash",
      "strategyVersion": "book-profile-v1",
      "analyzedAt": "2026-08-08T08:00:00.000Z"
    },
    "errorCode": null
  },
  "requestId": "...",
  "timestamp": "..."
}
```

`failed` 时 `candidate` 为 null，`errorCode` 记录异步失败原因。当前分类层可能产生：

- `CLASSIFICATION_SCHEMA_INVALID`：严格 Schema 校验失败，包括 Tool arguments 非法 JSON、非法枚举、缺字段、额外字段或 confidence 越界；同一分析任务内最多进行两次脱敏修复，耗尽后才进入该失败终态。
- `CLASSIFICATION_REFUSED`：模型没有调用分类工具。
- `CLASSIFICATION_TIMEOUT`：模型请求超时。
- `CLASSIFICATION_UNAVAILABLE`：模型配置在执行时缺失或模型服务不可用。
- `PROFILE_GENRE_INVALID`：结构化结果把主类型重复放入次类型，未通过画像领域约束。
- `ANALYSIS_WORKER_FAILED`：未映射的 worker 执行错误。

查询其他用户的书返回 `404 / code 40401 / details.reason=BOOK_NOT_FOUND`。

## 11.5 分类输入、Schema 与采样边界

第一轮只发送：标题、作者、简介、格式、当前 `contentRevision`、最多 200 个目录节点、章节数、目录节点数和正文字符数。

目录缺失或第一轮 `confidence < 0.75` 时进行第二轮分类。第二轮最多读取 3 个代表性 section，每段最多 2000 字符，总计最多 6000 字符；样本携带当前 revision 下的稳定 Locator 和章节路径。采样过程中 revision 变化会中止，不会把跨 revision 内容混入画像。

模型必须调用严格 function schema，输出且只输出以下字段：

- `primaryGenre`：`technical`、`argumentation`、`narrative`、`paper`、`poetry`、`popular-science`、`self-help`、`general` 之一。
- `secondaryGenres`：相同枚举的数组，不能包含主类型。
- `traits`：至少 1 项、最多 20 项，每项最多 80 字符，必须使用中文描述结构特征。
- `confidence`：0-1 的有限数值。
- `classificationSummary`：1-500 字符的中文简洁分类依据，不是思维链。

`secondaryGenres` 可以为空数组，表示没有足够证据支持可信的次类型，不代表分析失败。服务端会对中文字段做本地校验；不符合时使用脱敏问题进入既有修复流程，耗尽修复额度后任务失败。

只有同时通过上游严格 Schema、本地 Zod 校验和领域校验的结果才会写入 `book_analysis_candidates`；候选不会自动写入 Catalog 的 `book_profiles`。数据库不保存 API Key 明文、完整正文、完整上游响应或隐藏思维链。

严格 Schema 仍由服务端校验，不能依赖模型供应商保证。遇到 `CLASSIFICATION_SCHEMA_INVALID` 时，应用层在同一任务内最多再请求两次完整分类；修复上下文只包含 `{ attempt, issues: [{ path, code }] }`，最多 10 项，不包含上一轮 Tool arguments、字段值、正文或上游错误原文。两次额度由首轮元数据分类和可选的正文采样分类共享；拒绝、超时和不可用错误不参与该修复循环。

## 11.6 任务恢复与 AI 阅读前置

任务保存在 SQLite，活动任务由 `(userId, bookId, contentRevision, strategyVersion)` 条件唯一索引保证幂等。worker 使用带 fencing generation 的 lease；重启后可恢复 pending 或 lease 过期的 running 任务。单次 worker 并发默认 1，最高 4。

创建 `ai-reading` 任务时必须取得当前有效画像：

| 分析状态 | AI 阅读结果 |
|----------|-------------|
| `ready` 且 revision、策略有效 | 允许创建 |
| `not_analyzed` | 409 / 40004 / `BOOK_ANALYSIS_REQUIRED` |
| `pending` / `running` | 409 / 40004 / `BOOK_ANALYSIS_IN_PROGRESS` |
| `failed` | 409 / 40004 / `BOOK_ANALYSIS_FAILED` |
| `stale` | 409 / 40004 / `BOOK_ANALYSIS_REQUIRED` |
| `unsupported` | 409 / 40004 / `BOOK_ANALYSIS_UNSUPPORTED` |

有效画像会作为不可变可信上下文冻结进 AI 阅读任务，详情见 [AI 阅读任务接口](../50-ai-reading/ai-reading.md)。
