# 图书搜索

本模块用于从外部数据源搜索图书，并返回可加入个人书架的标准化搜索结果。

- 基础路径：`/api/v1/search`
- 鉴权：全部接口需登录
- Controller：`src/modules/acquisition/search/presentation/http/search.controller.ts`
- 响应格式：遵循 [通用约定](../00-common.md)
- 后续流程：搜索结果可通过 [个人书架接口](../30-intelligent-library/library.md) 的 `from-search` 入库

实现边界：搜索、缓存和来源选择属于 `AcquisitionModule`；具体 Zlibrary HTTP Adapter 只实现 Acquisition 公开的搜索 Port。来源列表由 capability-based `SourceRegistry` 选择，HTTP 契约不暴露 Registry 或上游凭据。

## POST /api/v1/search/books

需登录。支持 `zlibrary` 和 `all`；当前只注册 Zlibrary，因此 `all` 等价于 `zlibrary`。

**请求体**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| keyword | string | 是 | - | 搜索关键词，自动去除首尾空格 |
| page | number | 否 | 1 | 页码，最小 1 |
| pageSize | number | 否 | 20 | 每页条数，范围 1-50 |
| sourcePlatform | string | 否 | "all" | 数据源：`zlibrary` 或 `all`（当前均选择 Zlibrary） |
| formats | string[] | 否 | `[]` | 格式多选，仅允许 `pdf`、`epub`、`mobi`、`azw3`；多项为 OR，空数组表示全部 |

来源适配器会在查询时应用 `formats`，因此筛选发生在分页之前。页内去重包含格式，同一书籍版本的 PDF 与 EPUB 不会合并成一个下载项。

**成功响应 (200)**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "id": "zlibrary:12345678",
        "sourceBookId": "12345678",
        "sourcePlatform": "zlibrary",
        "title": "深入理解计算机系统",
        "authors": ["Randal E. Bryant", "David R. O'Hallaron"],
        "publisher": "机械工业出版社",
        "publishYear": 2016,
        "editionTag": null,
        "language": "chinese",
        "formats": ["pdf"],
        "fileSize": 15728640,
        "coverUrl": "https://...",
        "description": "本书从程序员的视角...",
        "sourceUrl": "https://...",
        "downloadPath": "/dl/z6GKBQ7r6b",
        "downloadable": true,
        "availability": "available",
        "md5": "d41d8cd98f00b204e9800998ecf8427e",
        "sha256": null,
        "hash": "a1b2c3d4e5f6..."
      }
    ],
    "total": 235,
    "page": 1,
    "pageSize": 20,
    "hasNext": true,
    "nextPage": 2,
    "requestId": "..."
  },
  "requestId": "...",
  "timestamp": "..."
}
```

## SearchResultItem 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 搜索唯一 ID，格式 `{sourcePlatform}:{sourceBookId}` |
| sourceBookId | string | 上游数据源原始 ID |
| sourcePlatform | string | 数据源平台标识（当前只会是 `zlibrary`） |
| title | string | 书名 |
| authors | string[] | 作者列表 |
| publisher | string \| null | 出版社 |
| publishYear | number \| null | 出版年份 |
| editionTag | string \| null | 版本标识 |
| language | string \| null | 语言 |
| formats | string[] | 文件格式（限定为 `pdf`、`epub`、`mobi`、`azw3`） |
| fileSize | number \| null | 文件大小（字节） |
| coverUrl | string \| null | 封面图 URL（`/img/cover-not-exists.png` 会转换为 null） |
| description | string \| null | 书籍描述 |
| sourceUrl | string \| null | 来源 URL（书籍详情页路径） |
| downloadPath | string \| null | 来源提供的下载路径 |
| downloadable | boolean | 当前是否可下载（取决于是否有 hash） |
| availability | string | `available` 或 `unavailable` |
| md5 | string \| null | MD5 校验值 |
| sha256 | string \| null | SHA-256 校验值 |
| hash | string \| null | 来源文件 hash（入库和下载时必须传递） |

## 分页字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| total | number | 搜索结果总数（取自上游真实值，多源时为各源之和） |
| page | number | 当前页码 |
| pageSize | number | 每页条数 |
| hasNext | boolean | 是否有下一页 |
| nextPage | number \| null | 下一页页码（无下一页时为 null） |
| warnings | string[] | 警告信息（部分源不可用时提示） |
| requestId | string | 请求追踪 ID |

**错误场景**：

| 场景 | 错误码 | 说明 |
|------|--------|------|
| 参数校验失败 | 40002 | keyword 为空、pageSize 超出范围或 formats 含非法/重复值 |
| sourcePlatform 非法 | 40002 | 非 `zlibrary`、`all` 之一；`annas_archive` 在 ValidationPipe 层拒绝 |
| 上游不可用 | 50002 | zlibrary API 请求失败 |

---
