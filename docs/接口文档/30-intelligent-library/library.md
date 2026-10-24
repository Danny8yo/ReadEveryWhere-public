# 个人书架与文件

- 基础路径：`/api/v1/library/books`
- 鉴权：除 signed file URL 外均需 HttpOnly Cookie 服务端会话
- Controller：`src/modules/intelligent-library/library-queries/presentation/http/library.controller.ts`
- 业务归属：Catalog 负责 Book/BookFile 命令，LibraryQueries 负责列表/详情和 HTTP 投影；内部 `LibraryBookView` 是兼容查询模型，不是领域实体，也不属于公开 TypeScript 契约

## 接口清单

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/` | 分页列出书架，支持 `keyword`、`primaryGenre`、`secondaryGenre` 和可重复 `formats` |
| GET | `/:id` | 单书详情 |
| GET | `/:id/reading-profile` | 读取当前正式阅读画像 |
| PATCH | `/:id/reading-profile` | 用户编辑主类型、次类型和分类理由 |
| DELETE | `/:id/reading-profile` | 清空当前正式阅读画像 |
| POST | `/` | 手动创建书籍元数据 |
| POST | `/from-search` | 搜索结果入库；必须保留 `hash/sourceBookId/sourcePlatform` |
| PATCH | `/:id` | 局部编辑元数据 |
| DELETE | `/:id` | 删除单书及级联数据 |
| POST | `/batch-delete` | 最多 500 个 ID，逐项返回 deleted/skipped |
| GET | `/import-capabilities` | 返回当前运行时单文件上传上限，禁止缓存 |
| POST | `/import` | 单文件导入，multipart 字段 `file` |
| POST | `/import/batch` | 最多 20 个文件，multipart 字段 `files`，逐文件隔离结果 |
| POST | `/:id/file-access` | 生成短期 signed file URL |
| GET | `/:id/file?token=...` | 公开 signed 文件流，支持 Range |
| GET | `/:id/stream` | 会话鉴权文件流，支持 Range |

列表 `page` 范围为 `1-10000`，`pageSize` 范围为 `1-50`。格式可重复传递，例如 `?formats=pdf&formats=epub`，多项为 OR；省略表示全部。已交付文件以真实 MIME 映射格式，未下载书籍回退到 `source_refs.format`，无格式书籍只在未筛选列表出现。

## 书库版本与实时通知

列表返回 `{ items, total, page, pageSize, libraryVersion, progressSequence }`。排序固定 `updatedAt DESC, id DESC`。列表及详情条目额外返回 `downloadTaskId: number | null`，对应最新下载任务；命令结果的内部 Catalog View 不承诺下载任务字段。

`libraryVersion = { epoch: string, revision: number }` 是当前进程的用户级缓存验证标记，不是 Book version 或持久事件游标。每次进程启动生成新 epoch；不同 epoch 的 revision 不比较大小。无订阅者时仍推进并保留计数。`progressSequence` 为该用户当前 epoch 的进度水位，与列表读取在同一同步执行段内取得。

- `GET /api/v1/library/sync-state`：普通成功信封的 `data` 为 `{ libraryVersion }`，`Cache-Control: no-store`。
- `GET /api/v1/library/stream`：Cookie 会话鉴权，`text/event-stream`，不套成功信封，不接受 userId。先装订阅再发送 `ready`，连接不重放历史事件，忽略 Last-Event-ID。

| event | data |
|---|---|
| `ready` | `{ libraryVersion }` |
| `library_changed` | `{ libraryVersion }` |
| `download_progress` | `{ epoch, sequence, bookId, taskId, progress }` |

`progress` 为 0–100 整数，只有百分比真正改变才推进用户级 `sequence`；进度不推进普通 revision。每任务最多 500ms 发送一次，首条立即发送，窗口保留最新值；状态转换立即普通失效并清理待发进度。客户端按 taskId 匹配，保留晚于 HTTP `progressSequence` 的已收进度，拒绝旧任务/旧序号覆盖。重连或前台恢复时有活动下载的当前页需重新拉取，以补齐可能漏掉的百分比。

普通变化来自 Catalog 元数据/来源/画像/删除/文件交付、下载状态、豆瓣评分、分析摘要。提交后同步推进版本，再分发；外层事务回滚不推进。通知使该用户查询缓存失效，只拉当前可见查询。连接 ready/恢复后用 sync-state 校验，epoch 改变强制失效；没有变化时不周期轮询。

服务端采用 better-sse 0.16.1 处理 SSE 帧与连接生命周期，内置每 15 秒注释心跳。公共适配器每次实际发送（包括心跳）复核会话存在及期限，不续期。过期关流，重连获得 401；数据库错误记录并关流，不伪装成未登录。Node 写缓冲要求 drain 或下一帧超过 64KiB 上限时关闭慢消费者，由恢复校验收敛；不维护无界发送队列。业务通知失败记录并关闭相应订阅，不将已提交写入伪装成回滚。

仅支持单后端进程，不增加数据库表、Redis、MQ、Outbox。多实例须同时替换版本来源与分发能力。先部署新后端再部署新前端；旧前端继续兼容原列表与阅读状态协议。

## LibraryBook 响应

稳定字段分组：

- 元数据：`id/userId/title/authors/authorsText/isbn/language/coverUrl/description/publisher/publishYear/editionTag`。
- 来源：`sourcePlatform/sourceBookId/sourceUrl`。
- 版本：`version/createdAt/updatedAt`。
- 文件：`fileName/fileSize/isDownloaded/fileUrl/checksum/mimeType/format/downloadStatus/downloadProgress`。`fileSize` 是当前 active artifact 的真实字节数；没有 current artifact 的纯元数据书籍返回 `null`。
- 外部评分：可空 `doubanRating`，包含 `sourceBookId/sourceUrl/title/rating/ratingCount/fetchedAt`；读取列表或详情不会触发实时豆瓣请求。
- AI 画像摘要：可选 `bookAnalysis`，包含 status、primaryGenre、displayLabel、confidence、analyzedAt、stale。当前 revision/策略下已应用候选也保持 `ready`，但不会提供可重复应用的 `candidateId`。
- 正式当前画像：`readingProfile`，每本书恰有一份；`confidence` 为结构化 `{ kind: "ai-score"|"user-determined"|null, score: number|null }`。

`bookAnalysis` 是当前 revision/策略下的只读投影，不属于用户元数据。完整状态见 [书籍 AI 预分析](book-analysis.md)。

`POST /:id/file-access` 签出的 URL 在同一小时内逐字节稳定（token 的过期时间按整点对齐），文件响应带 `ETag`、`Last-Modified` 和 `Cache-Control: private, max-age=3600`，并支持 `If-None-Match`（304）与 `If-Range`（校验器不匹配时忽略 Range 回整份）。这三件事缺一不可：URL 每次都变、没有校验器、max-age=0，任意一条都会让浏览器缓存 100% 失效，同一本书每次打开都要把打开阶段那 1MB 多重新下一遍。

文件大小不使用搜索结果中的预估值，一律以落库文件的实际字节数为准；只有成功激活并成为 current pointer 的 `book_artifacts.file_size` 才会出现在导入响应、列表和详情中。EPUB/MOBI/AZW3 的落库文件就是接收到的字节；PDF 会在落库前重建页树，因此 `fileSize` 描述的是重建之后的文件，可能与上传或下载到的原始字节不同。`checksum` 始终是来源字节的哈希，不随重建改变。

## 创建与编辑约束

- 硬去重优先使用 `(sourcePlatform, sourceBookId)`；软去重使用规范化书名、作者、出版年和版本。
- `sourceBookId` 非空时必须显式提供非空 `sourcePlatform`；`sourcePlatform` 为非 `manual` 值时必须同时提供 `sourceBookId`。省略两者或显式使用 `manual` 且不提供来源 ID 均按手工书籍创建。
- `version` 对外仍是递增数字；本接口不要求客户端提交 expectedVersion。后端 Repository 内部使用 `WHERE version = ?` CAS；冲突时重新加载并重放当前命令，最多三次，对 HTTP 调用方透明。元数据候选应用接口另有显式版本要求，见 [元数据刮削](metadata.md)。
- 书架不维护逐字段锁定状态。用户确认的后续刮削候选可以覆盖此前手工编辑；过期候选由 Book version 冲突阻止。
- `from-search` 必须提交 `format`，并与 hash 一起写入 `source_refs`；格式限定为 `pdf/epub/mobi/azw3`。
- 历史兼容：仅提交 `isbn` 仍视为“没有可编辑字段”并返回 400；`isbn` 与 title/authors 等其他可编辑字段一起提交时可以更新。
- 历史兼容：手工创建和 from-search 要求至少一个非空作者，metadata update/apply 可以清空作者。

## 文件导入

支持 EPUB、PDF、MOBI、AZW3，默认单文件最大 200MB，由 `IMPORT_MAX_FILE_SIZE_MB` 调整。该变量必须是正整数，非法配置会使应用启动失败。文件内容通过魔数/容器结构校验，不能只信扩展名或 MIME。

`GET /import-capabilities` 与单文件、批量导入的 Multer 限制读取同一份后端配置，返回 `{ maxFileSizeBytes }`，并携带 `Cache-Control: no-store`。前端必须以该响应显示和校验单文件上限，不维护自己的固定 MB 数值；能力读取失败时禁止选择和提交文件。

单文件表单可带 `title/authors/isbn/coverUrl/conflictPolicy`。成功返回 `ImportBookResult`：

```json
{
  "importStatus": "imported",
  "metadataStatus": "pending",
  "scrapeQuery": "书名 作者",
  "scrapeQueryStrategy": "title_author",
  "originalFileName": "book.epub",
  "storedFileName": "book.epub",
  "book": { "id": 1, "title": "...", "fileSize": 1536000 }
}
```

`metadataStatus` 可为 `none/pending/scraping/candidates_found/applied/skipped/failed`。批量导入返回 `items/importedCount/failedCount`，每个 item 独立包含 book 或 error；一个文件失败不回滚其他成功项。

文件写入后若 EPUB 元数据解析、书籍创建或 artifact 激活/current pointer 持久化失败，导入会删除本次写入的文件；书籍已经创建时还会删除该书，失败 artifact 保留为可审计的 aborted 账本并等待 GC，避免留下 active 孤儿。`overwrite` 对已存在目标使用 imports staging 路径，因此失败补偿不会破坏原文件；清理失败会与原始错误一起暴露，不再静默吞掉。active artifact checksum 唯一约束竞争仍映射为 `40003 RESOURCE_CONFLICT`。批量导入按文件执行同样补偿，失败项不会清理或回滚其他成功项。

`conflictPolicy`：`rename`（默认）、`overwrite`、`skip`。元数据优先级为用户表单 > EPUB 内嵌 > 文件名推断 > 默认值；非 EPUB 主要依赖表单与文件名。

导入没有表单作者且文件内也没有作者时，仍按历史行为创建 `authors: []`。导入专用兼容入口不 trim 表单 `title`（包括纯空白字符串）；`authors` 返回规范化去重后的数组，但 `authorsText` 保留分割、首尾 trim 后的原始顺序、重复项和内部空格。该差异不适用于手工创建或后续 metadata 编辑。checksum 在写盘前直接对上传 Buffer 计算 SHA-256，是查重口径；`fileSize` 描述落库文件（PDF 重建页树后与来源字节不同）。本地导入 artifact 的 `source_platform/source_url` 为 `NULL`。

`overwrite` 仍表示允许使用同名文件导入，但实现先写入唯一 staging 路径，再由 Catalog artifact 交付流程原子 rename 到受管路径；原同名路径不会被失败补偿删除。EPUB 已通过格式校验后，缺失 `container.xml`、rootfile 或 OPF metadata 会返回明确的文件校验错误；非 EPUB（PDF/MOBI/AZW3）metadata 解析返回空值。

## 文件访问

- `/stream` 需要服务端会话 Cookie；`/file` 使用 `file-access` 生成的短期 token，适合 PDF.js/iframe 等不便携带 Header 的读取场景。
- signed token 绑定 userId、bookId 和过期时间，默认 7200 秒。
- 两个流接口都支持 `200/206/416` 和 `Accept-Ranges`，不经过普通 JSON 成功包装。
- 文件响应的 `Content-Type` 只会是 EPUB/PDF/MOBI/AZW3 四种 MIME 之一，库中其他历史值一律按 `application/octet-stream` 下发；并带 `Content-Security-Policy: sandbox; default-src 'none'` 与 `X-Content-Type-Options: nosniff`，直接在浏览器打开也不会以站点源执行内容。阅读器用 fetch 读取字节，不受影响。客户端中途断开时立即关闭文件句柄。
- current pointer 缺失返回 40401；active artifact 指向的物理文件缺失返回 40403。最终 Schema 不再允许“文件行存在但路径/状态不可用”的中间态。磁盘权限或其他 I/O 错误不伪装成 404，而是交由内部错误处理。Presentation 只经 Catalog 内部 `BookFileStreamingQueryPort` 取得最小文件投影，不直接查询 SQLite。
