# 选区问答与书内关键词检索

基础路径 `/api/v1/selection-qa`。除特别说明外，所有接口均要求已登录的 HttpOnly 会话 Cookie；浏览器请求携带 credentials。普通 JSON 响应使用[统一信封](../00-common.md)，事件流使用 SSE。此路由的请求体上限为 256 KiB。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/selections/resolve` | 验证选区并返回规范化定位 |
| POST | `/conversations` | 用 `{commandId,bookId,selection,question}` 创建会话和首轮 |
| GET | `/conversations?bookId=&cursor=&limit=` | 按书分页列出会话；`limit` 为 1–100，默认 20 |
| GET | `/conversations/:id` | 读取会话与原始选区 |
| GET | `/conversations/:id/turns?cursor=&limit=` | 按轮次序号分页读取轮次 |
| POST | `/conversations/:id/turns` | 用 `{commandId,question,retryOfTurnId?}` 创建追问 |
| GET | `/turns/:id/events?afterSequence=` | 按持久序号接收或补放 SSE 事件 |
| POST | `/turns/:id/stop` | 停止活动轮次 |
| POST | `/turns/:id/apply-annotation` | 把已完成回答应用到批注 |
| DELETE | `/conversations/:id` | 删除无活动轮次的会话 |

`selection` 必须包含 `scope`、`displayedQuote`，以及 `source` 或 `cfi` 二选一。服务端重新验证原选区、书籍归属与文件版本；客户端的解析结果不替代服务端验证。问题最长 4000 UTF-16 字符，选文最长 12000，批注追加文字最长 50000。创建命令按用户持久幂等；同一 `commandId` 携带不同请求会返回冲突。

问答运行器在当前书籍的规范化正文索引中按关键词检索，使用词面内短语匹配、词面间等权 OR。规划模型最多提供四条查询，每条最多 16 个词面、128 UTF-16 字符；宿主不把用户问题自动拆成检索词。单轮最多两次搜索，规划模型从候选中选择证据，服务端扩展并验证引用后生成答案。检索是书内关键词检索，并非向量检索；未命中或证据不足只表示本轮取得的片段不足，不能证明全书没有相关内容。追问会使用已完成轮次的检索摘要，重复查询可被复用；用户明确要求重试或需求改变时可再次检索。

事件形状为 `{schemaVersion:1,turnId,sequence,kind,data}`，包含状态、正文增量、引用和终态。断线后以 `afterSequence` 继续，客户端按 `sequence` 去重；断线不停止任务。每轮有 240 秒截止时间，最多六次模型调用、六次书内操作及 24000 个正文字符读取预算。轮次快照包含已持久化的回答、引用、过程与最后事件序号。证据跳转分别使用 `GET /conversations/:id/location` 与 `GET /turns/:id/evidence/:evidenceId/location`，服务端再次核对当前文件版本。

书籍文件或提取版本变化会冻结会话。无权限或不存在返回 404；活动轮冲突、版本变化、重复命令负载不一致返回 409；非法选区与请求字段返回 400。模型或索引失败保留已发布的部分回答与可追溯终态，不能当作成功答案。
