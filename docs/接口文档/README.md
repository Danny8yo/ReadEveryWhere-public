# ReadEveryWhere HTTP 接口

基础路径为 `/api/v1`。普通网页请求使用服务端会话与 HttpOnly Cookie，写请求校验 Origin；Reader Tools 的受限 AI Token 单独说明。响应信封、文件流与 SSE 例外见[通用约定](00-common.md)。

| 领域 | 文档 |
| --- | --- |
| 身份 | [注册、登录与会话](10-identity/auth.md) |
| 书籍采集 | [总览](20-acquisition/README.md)、[搜索](20-acquisition/search.md)、[下载](20-acquisition/download.md)、[个人书源配置](20-acquisition/source-settings.md) |
| 智能书库 | [总览](30-intelligent-library/README.md)、[书库与文件](30-intelligent-library/library.md)、[元数据](30-intelligent-library/metadata.md)、[书籍预分析](30-intelligent-library/book-analysis.md) |
| 阅读状态 | [批注、书签与进度](40-reading-state/reading-state.md) |
| AI 阅读 | [模型配置](50-ai-reading/ai-reading.md)、[选区问答与关键词检索](50-ai-reading/selection-qa.md) |
| 阅读工具 | [Reader Tools HTTP 契约](90-internal/reader-tools.md) |

外部书源 Provider 的实现未在本仓库公开；相关接口文档保留本服务的请求与响应形状，不公开上游接口细节。精确字段以同一基线中的 Controller 和 DTO 为准。
