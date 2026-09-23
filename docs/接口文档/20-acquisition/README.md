# 获取模块 (Acquisition)

从外部书源获取书籍的三个 HTTP 切片：搜索、下载任务、书源凭据配置。三者共享同一套来源抽象，因此归在同一个后端顶层模块 `src/modules/acquisition/` 下。

| 文档 | 基础路径 | 用途 |
|------|----------|------|
| [搜索](search.md) | `/api/v1/search` | 从外部书源搜索，返回可入库的标准化结果 |
| [下载管理](download.md) | `/api/v1/downloads` | 创建、查询、取消下载任务 |
| [Zlibrary 用户配置](source-settings.md) | `/api/v1/user/zlibrary-config` | 配置个人 Zlibrary 凭据与镜像域名 |

全部接口需登录，响应遵循 [通用约定](../00-common.md)。

## 完整链路

```
配置 Zlibrary 凭据            PUT  /api/v1/user/zlibrary-config
  ↓
搜索                          POST /api/v1/search/books
  ↓  结果项必须保留 hash / sourceBookId / sourcePlatform / format
加入书架                      POST /api/v1/library/books/from-search
  ↓  后端写入 source_refs
创建下载任务                  POST /api/v1/downloads/tasks   （只传 bookId + sourcePlatform）
  ↓  后端自动从 source_refs 查出 hash
轮询任务状态                  GET  /api/v1/downloads/tasks/:taskId
  ↓  completed
文件可读                      GET  /api/v1/library/books/:id/stream 或 /file
```

链路中间的入库步骤属于智能书库，见 [个人书架与文件](../30-intelligent-library/library.md)。

前端要注意的三处耦合：

- **搜索结果的 `hash` 必须原样带到入库请求**。没有 hash 的书无法下载，创建任务时返回 `40002`。
- **入库必须提交 `format`**，限定 `pdf/epub/mobi/azw3`；下载任务不再单独指定格式。
- **下载不接受前端传 hash**。`hash` 与 `sourceBookId` 是后端从 `source_refs` 填充的只读字段。

没有可用 Cookie 时下载直接失败，不存在部署级凭据回退；前端应引导用户重新登录或导入 Cookie。
