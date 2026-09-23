# 元数据刮削

本模块用于从用户选择的单个元数据供应商获取候选，供前端确认后补全或更新 Book metadata。

- 基础路径：`/api/v1/metadata`
- 鉴权：全部接口需登录
- 响应格式：普通接口遵循 [通用约定](../00-common.md)
- 当前代码：`src/modules/intelligent-library/metadata-enrichment/`；Zlibrary/Douban 外部 Adapter 位于 `src/integrations/`，AI provider 与格式无关的生成流程位于 MetadataEnrichment

## 6.1 选择 provider 刮削

```
POST /api/v1/metadata/scrape
```

需登录。每次请求只执行一个 provider，并把候选与当前用户拥有的目标书籍比较；成功返回 `MatchedMetadataCandidate[]`，HTTP 状态为 `201 Created`。Provider 只负责获取候选，匹配分类由 MetadataEnrichment Application 层统一完成，因此 Zlibrary 与 Douban 使用同一套规则。

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
```json
{ "provider": "zlibrary", "bookId": 123, "keyword": "ISBN 或书名" }
{ "provider": "douban", "bookId": 123, "keyword": "书名" }
{ "provider": "AI", "bookId": 123 }
```

`provider` 只允许 `zlibrary`、`douban`、`AI`。所有 Provider 必须提供当前用户拥有的 `bookId`；Zlibrary/Douban 还必须提供 `keyword`。AI 的目标书籍还必须有已完成文件。

Provider 上下文按需解析：只有 Zlibrary 读取当前用户的 Z-Library base URL；只有 Douban 读取用户 Cookie，并在用户未配置时回退部署默认 Cookie；AI 不读取两类外部供应商配置。Cookie 不会跨 provider 转发。

AI 第一轮 LLM 根据书名、作者和目录选择前置section(前言、推荐序等正式章节外的内容)；服务端只按合法 section ID 读取有界内容，第二轮 LLM 生成结构化 metadata 候选。第一版只支持 EPUB，其他格式返回 `UNSUPPORTED_FORMAT`。

## MatchedMetadataCandidate 字段说明

每一项包含原始 `candidate: ScrapedBook` 和解释性匹配结果 `match`：

| 字段 | 类型 | 说明 |
|------|------|------|
| match.level | `edition \| work \| ambiguous \| conflict` | 同一版本、同一作品但版本未知、依据不足或存在冲突 |
| match.signals | string[] | `content_derived/isbn_exact/title_exact/title_close/author_overlap` 等正向依据 |
| match.conflicts | string[] | `isbn_mismatch/title_mismatch/author_mismatch` 等冲突 |

候选按 `edition -> work -> ambiguous -> conflict` 排序，同级保持 Provider 原顺序。ISBN 一致可判定同一版本；书名或主标题一致且作者有交集只能判定同一作品；ISBN 冲突不能被书名相同掩盖。AI 候选来自当前书籍内容，标记为 `content_derived`。

### ScrapedBook 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| sourcePlatform | string | 供应商标识：`zlibrary`、`douban` 或 `AI` |
| sourceBookId | string | 供应商侧书籍 ID |
| sourceUrl | string \| null | 供应商详情页链接 |
| title | string | 书名 |
| authors | string[] | 作者列表 |
| isbn | string \| null | ISBN（部分供应商可能不返回） |
| publisher | string \| null | 出版社 |
| publishYear | number \| null | 出版年份 |
| description | string \| null | 书籍描述 |
| coverUrl | string \| null | 封面图 URL |
| language | string \| null | 语言；当前已属于 Book metadata，可通过 apply 保存 |
| editionTag | string \| null | 版本标识 |

**前端调用示例**：

```javascript
const response = await fetch('/api/v1/metadata/scrape', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'AI', bookId: 123 }),
});
const matches = (await response.json()).data;
const firstCandidate = matches[0]?.candidate;
```

**当前注册供应商**：

| 供应商 | 状态 | 说明 |
|--------|------|------|
| zlibrary | 可用 | 通过来源适配器返回候选元数据 |
| douban | 可用 | 通过来源适配器返回候选元数据 |
| AI | 可用 | 读取内置 EPUB 的目录和模型选择的前置材料，通过两次 LLM 调用生成一个候选 |

**错误场景**：

| 场景 | 说明 |
|------|------|
| 未登录 | 返回 401 |
| provider、bookId 或对应关键词缺失 | 返回参数校验错误 |
| 书籍不存在或不属于当前用户 | 返回书籍 404，且不会请求外部 Provider |
| AI 书籍不存在/无文件/非 EPUB | 返回对应资源、文件或格式错误 |

## 6.2 豆瓣评分候选查询

```
GET /api/v1/metadata/douban-rating?q=书名
```

需登录。根据书名查询豆瓣评分候选，供前端在搜索结果详情页展示并由用户手动选择匹配结果。接口只返回候选，不会自动写入书架图书，也不会覆盖用户已确认的元数据。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 查询关键词，当前前端默认使用书名。后端会 `trim`，最长 100 个字符 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "sourcePlatform": "douban",
      "sourceBookId": "25862578",
      "sourceUrl": "https://book.douban.com/subject/25862578/",
      "title": "被讨厌的勇气",
      "authors": ["岸见一郎", "古贺史健"],
      "publisher": "机械工业出版社",
      "publishYear": 2015,
      "isbn": "9787111495482",
      "rating": 8.6,
      "ratingCount": 123456
    }
  ],
  "requestId": "req_xxx",
  "timestamp": "2026-06-14T00:00:00.000Z"
}
```

**DoubanRatingCandidate 字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| sourcePlatform | `"douban"` | 固定为豆瓣来源 |
| sourceBookId | string | 豆瓣 subject ID |
| sourceUrl | string | 豆瓣详情页链接 |
| title | string \| null | 豆瓣书名 |
| authors | string[] | 作者列表 |
| publisher | string \| null | 出版社 |
| publishYear | number \| null | 出版年份 |
| isbn | string \| null | ISBN |
| rating | number \| null | 豆瓣评分，无法解析时为 `null` |
| ratingCount | number \| null | 评分人数，无法解析时为 `null` |

**行为说明**：

| 场景 | 说明 |
|------|------|
| q 参数为空 | 返回参数校验错误 |
| q 超过 100 个字符 | 返回参数校验错误 |
| 未找到候选 | 返回成功响应，`data` 为空数组 |
| 候选详情页部分失败 | 跳过失败候选，返回已成功解析的候选 |
| 豆瓣请求失败或解析失败 | 跳过失败候选，返回已成功解析的结果；具体节流行为以 Provider 当前实现为准 |

## 6.3 保存书架豆瓣评分

```
PUT /api/v1/metadata/books/:id/douban-rating
```

需登录且书籍必须属于当前用户。请求体使用 `DoubanRatingCandidate` 字段；`sourcePlatform` 必须为 `douban`，评分范围为 0-10，评分人数不得为负。服务端忽略客户端时间并生成 `fetchedAt`。

同一本书再次选择候选会按 `book_id` 覆盖旧快照。该操作不修改 Book version 或 `updatedAt`，因此不会改变书架排序；后续列表/详情直接返回已保存快照，不会自动访问豆瓣。删除书籍时快照级联删除。

响应字段为 `provider/sourceBookId/sourceUrl/sourceTitle/rating/ratingCount/fetchedAt`。书籍不存在或不归当前用户时返回既有书籍 404 契约。

## 6.4 应用选中的元数据

```
PATCH /api/v1/metadata/books/:id
```

请求必须包含候选检索时对应的正整数 `expectedVersion`，并可包含 title、authors、isbn、language、coverUrl、description、publishYear、publisher、editionTag、sourcePlatform、sourceBookId、sourceUrl。单书和批量前端都必须先由用户确认候选；批量流程只把 `edition` 候选预选为可应用，其余候选进入集中审核。

应用已确认候选会覆盖请求中指定的现有 metadata，不维护逐字段锁定状态。UseCase 先比较当前 Book version 与 `expectedVersion`，Repository save 再执行同一版本 CAS；任一阶段发现版本已变化都返回 HTTP 409、业务码 `40003`，消息要求刷新候选后重试，服务端不会自动重放旧候选。

Apply 可以把 authors 更新为空数组；空 title 返回参数校验错误。请求中的 sourcePlatform/sourceBookId/sourceUrl 会通过 DTO 校验，但当前有意不修改权威 `source_refs`。请求包含任一 metadata 字段时，即使值相同也保持既有 version 递增语义；只包含 source 字段时 version 不变。

## 6.5 用户豆瓣 Cookie

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/v1/metadata/douban-config` | 返回全局请求间隔和当前用户 Cookie |
| PATCH | `/api/v1/metadata/douban-config` | 更新/清空当前用户 Cookie |

Cookie 使用 `ENCRYPTION_KEY` 加密存储。请求体中的 `requestIntervalMs` 虽被 DTO 接受，但当前 Controller 有意忽略；请求间隔只能由部署者通过 `DOUBAN_REQUEST_INTERVAL_MS` 配置。

`user_douban_config` 与 `book_douban_ratings` 仅由 MetadataEnrichment 的 SQLite Adapter 写入；LibraryQueries 只读投影评分快照。Zlibrary 用户 base URL 仍由 Acquisition 拥有，并通过外层 Zlibrary metadata context Adapter 提供，MetadataEnrichment 不访问其 Repository。

---
