# 下载管理

本模块用于创建、查询和取消电子书下载任务。下载通常依赖书籍先通过搜索结果加入书架，并携带上游 `hash`。

- 基础路径：`/api/v1/downloads`
- 鉴权：全部接口需登录
- 响应格式：遵循 [通用约定](../00-common.md)
- 前置流程：搜索图书 → 添加到书架 → 创建下载任务

## 下载流程概述

```
搜索 → 添加到书架(from-search, 携带 hash) → 创建下载任务 → 轮询任务状态 → 下载完成
```

前端创建下载任务只需传入 `bookId` + `sourcePlatform`，后端自动从 `source_refs` 表中查出 `hash` 和 `sourceBookId` 完成下载。

实现上，Acquisition 不直接访问 `books/source_refs/book_artifacts/book_current_artifacts`：归属、来源引用和既有文件分别经 IntelligentLibrary 公共查询 Port 获取，只有下载成功的 artifact 才经 `AttachBookFilePort` 交付 Catalog。交付时 Catalog 与导入一致按魔数检测格式，MIME 只取检测结果，忽略上游 Content-Type 与文件名；无法识别为 EPUB/PDF/MOBI/AZW3 时不入库，任务 `failed`，`errorMessage` 为 `下载的文件不是有效的 EPUB、PDF、MOBI 或 AZW3`。公共 Adapter 只转发到 `AttachBookFileUseCase/DetachBookFileUseCase`；Catalog 的 `SqliteBookArtifactRepository` 负责 artifact 账本和正常 pointer DML，删除协调器负责删书场景。来源下载或 artifact 交付失败时只更新本任务为 `failed`，不会建立 current pointer；若 artifact 已交付但任务完成状态写入失败，Catalog 会按 user/book/checksum/path 精确删除 pointer、退役 artifact 并撤销本次磁盘文件，再把任务记录为 `failed`。

## 7.1 创建下载任务

```
POST /api/v1/downloads/tasks
```

需登录。

**请求体**：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| bookId | number | 是 | 整数，≥1 | 书架中书籍的 ID |
| sourcePlatform | string | 是 | `zlibrary` | 下载来源平台；其他值在 ValidationPipe 层拒绝 |
| sourceUrl | string | 是 | 最大 2000 字符 | 来源 URL（实际下载使用后端查出的 hash，此处为参考值） |
| fileName | string | 否 | 最大 255 字符 | 期望保存的文件名 |

**成功响应 (201)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "userId": 1,
    "bookId": 1,
    "sourcePlatform": "zlibrary",
    "sourceUrl": "zlibrary:12345678",
    "requestedFileName": "深入理解计算机系统.pdf",
    "hash": "a1b2c3d4e5f6...",
    "sourceBookId": "12345678",
    "status": "queued",
    "progress": 0,
    "localPath": null,
    "errorMessage": null,
    "createdAt": "2026-05-02T10:30:00.000Z",
    "updatedAt": "2026-05-02T10:30:00.000Z"
  },
  "requestId": "...",
  "timestamp": "..."
}
```

## DownloadTask 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 任务 ID |
| userId | number | 所属用户 ID |
| bookId | number | 关联书架书籍 ID |
| sourcePlatform | string | 下载来源平台 |
| sourceUrl | string | 来源 URL |
| requestedFileName | string \| null | 期望文件名 |
| hash | string \| null | 文件 hash（后端从 `source_refs` 自动填充，只读） |
| sourceBookId | string \| null | 来源书籍 ID（后端从 `source_refs` 自动填充，只读） |
| status | string | 任务状态：`queued` → `downloading` → `completed` / `failed` / `canceled` |
| progress | number | 进度（0-100 整数） |
| localPath | string \| null | 下载完成后的本地文件路径 |
| errorMessage | string \| null | 失败原因；已完成文件的来源计数更新失败时为受控警告 `Source completion accounting failed` |
| createdAt | string | 创建时间（ISO 8601） |
| updatedAt | string | 更新时间（ISO 8601） |

**智能去重**：如果该书籍之前已成功下载且文件仍在磁盘上，任务会立即标记为 `completed`，不会重复下载。

创建任务会在写入 `download_tasks` 前检查 source reference 的 `hash`。后台处理中的取消是终态：provider 尚未返回时取消，迟到的 artifact 不会交付；若同步交付期间取消，已 attach 的本次文件会被补偿撤销，任务保持 `canceled`。普通内部异常写入稳定的 `Download failed`，不会把内部错误原文暴露到 `errorMessage`；明确的上游下载异常保留受控消息和上游摘要。来源完成计数失败不回滚已经一致交付的文件，任务保持 `completed` 并记录受控警告。

**错误场景**：

| 场景 | 错误码 | 说明 |
|------|--------|------|
| sourcePlatform 非 zlibrary | 40002 | DTO ValidationPipe 只允许 zlibrary |
| 书籍不存在 | 40401 | bookId 不属于当前用户 |
| 缺少 source reference | 40002 | 书籍未通过 from-search 添加，无 source_refs 记录 |
| 缺少 hash | 40002 | source_refs 中 hash 为空，上游搜索结果可能不包含此书籍的 hash |

## 7.2 查询下载任务

```
GET /api/v1/downloads/tasks/:taskId
```

需登录。返回最新的 `DownloadTask` 对象（字段参见 [DownloadTask 字段说明](#downloadtask-字段说明)）。

**错误场景**：

| 错误码 | 说明 |
|--------|------|
| 40401 | 任务不存在或不属于当前用户 |

## 7.3 取消下载任务

```
DELETE /api/v1/downloads/tasks/:taskId
```

需登录。仅 `queued` 或 `downloading` 状态的任务可取消。

**成功响应 (200)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "canceled": true
  },
  "requestId": "...",
  "timestamp": "..."
}
```

已完成 / 失败 / 已取消的任务返回 `canceled: false`（不报错，`40004` 仅用于其他状态冲突场景）。

---
