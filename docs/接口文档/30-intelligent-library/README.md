# 智能书库 (IntelligentLibrary)

围绕「用户拥有的一本书」的全部能力：书架与文件、元数据补全、AI 预分析。对应后端顶层模块 `src/modules/intelligent-library/`。

| 文档 | 基础路径 | 用途 |
|------|----------|------|
| [个人书架与文件](library.md) | `/api/v1/library/books` | 列表、详情、创建、导入、删除、阅读画像、文件流 |
| [元数据刮削与豆瓣配置](metadata.md) | `/api/v1/metadata` | 单 provider 候选获取、应用候选、豆瓣评分快照与 Cookie |
| [书籍 AI 预分析](book-analysis.md) | `/api/v1/book-analysis` | 生成待确认的阅读画像候选 |

全部接口需登录（`GET /library/books/:id/file` 的 signed URL 除外），响应遵循 [通用约定](../00-common.md)。

## 三份文档的关系

书架是唯一的写入终点，另外两条链路都产出**待用户确认的候选**，确认后才回写书架：

```
                    ┌─ 元数据刮削 ─┐
                    │  POST /metadata/scrape        → MatchedMetadataCandidate[]
书架上的一本书 ─────┤  PATCH /metadata/books/:id    → 用户确认后写回 Book metadata
                    │
                    └─ AI 预分析 ──┐
                       POST /book-analysis/books/:id       → 入队
                       GET  /book-analysis/books/:id       → 轮询候选
                       POST /book-analysis/books/:id/apply → 用户确认后写回 readingProfile
```

两条链路的共同规则：

- **候选不会自动生效**，一律要求用户确认。
- **应用候选要带版本**。元数据 apply 必须携带候选检索时的 `expectedVersion`，版本已变化返回 `409 / 40003`，前端需刷新候选后重试，服务端不会自动重放旧候选。
- **书架列表和详情不会触发实时外部请求**。豆瓣评分是已保存的快照，`bookAnalysis` 是只读投影。

书架响应里的 `readingProfile` 是每本书唯一的正式画像，可由用户直接编辑（`PATCH /library/books/:id/reading-profile`），也可由预分析候选应用产生；AI 阅读要求它有效，见 [AI 阅读](../50-ai-reading/ai-reading.md)。

## 与其他模块的衔接

- 书籍来源和下载：[获取模块](../20-acquisition/README.md)。
- 批注、书签、进度：[阅读状态](../40-reading-state/reading-state.md)，通过 bookId 关联，不进入书架响应。
- EPUB 正文读取与 Locator：[Reader Tools](../90-internal/reader-tools.md)，非前端契约。
