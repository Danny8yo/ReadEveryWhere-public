# 选区问答与书内检索

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
| POST | `/turns/:id/apply-annotation` | 用 `{commandId,appendText,target,answerVersion?,acceptUnverified?}` 把回答应用到批注 |
| DELETE | `/conversations/:id` | 删除无活动轮次的会话 |

`selection` 必须包含 `scope`、`displayedQuote`，以及 `source` 或 `cfi` 二选一。服务端重新验证原选区、书籍归属与文件版本；客户端的解析结果不替代服务端验证。问题最长 4000 UTF-16 字符，选文最长 12000，批注追加文字最长 50000。创建命令按用户持久幂等；同一 `commandId` 携带不同请求会返回冲突。

新建会话、追问和事件流请求必须携带 `X-Selection-QA-Protocol: 2`，缺失或其他值返回 409 `QA_PROTOCOL_UPGRADE_REQUIRED`；只读历史不受影响。应用批注时须传当前 `answerVersion`（1–3），不匹配返回 409 `ANSWER_VERSION_MISMATCH`；未通过检查的终态草稿须显式传 `acceptUnverified: true`，否则返回 409 `UNVERIFIED_ANSWER_CONFIRMATION_REQUIRED`。生成、检查与修订期间不能应用。

## 执行模型

每轮由模型自主选择行动：书内检索、翻页取更多候选、读取选区上下文、重放近期引用、扩展证据、按目录分页浏览并读取完整结构单元，最后选择交付答案或请求澄清。宿主执行每个工具调用并把实际观察返回给下一次决策；可恢复的参数错误返回校验信息供模型修正，未知工具、跨书或跨用户参数、未知证据 ID 等直接终止。相同行动连续产生相同观察时不再执行，返回无进展观察。

书内检索在当前书籍的规范化正文索引上进行，模型每次最多提供四条查询，每条最多 16 个词面、128 UTF-16 字符；宿主不把用户问题自动拆成检索词。索引流水线可选汉字逐字短语，或 jieba 词路加 bigram 短语/软匹配的双路召回，多路结果按 RRF 融合并去除同章节重叠块。可选配置外部重排模型：配置后先取融合候选池再按重排顺序分页交付；重排超时或失败时退回融合结果交由模型筛选，不重试。检索是书内关键词检索，并非向量检索；未命中或证据不足只表示本轮取得的片段不足，不能证明全书没有相关内容。

答案以可见的流式草稿发布，生成结束后由独立的检查调用给出 pass / revise / insufficient 判决；revise 或 insufficient 会开启下一答案版本重新生成，最多 3 个版本，未收敛时以失败结束并保留草稿。只有当前版本通过检查才标记为 completed。检查本身是模型判断，不保证回答绝对正确。

| 资源 | 每轮上限 |
| --- | --- |
| 模型请求 | 40 次（决策、纠错、生成、检查共用，并为生成与检查预留额度） |
| 书内工具 | 60 次尝试 |
| 正文读取 | 累计 500000 UTF-16 字符 |
| 时间 | 创建后 20 分钟，含排队；最后 3 分钟保留给生成与检查 |
| 输出 | 决策 3072、生成与检查 8192 tokens，同时受模型配置约束 |

## 事件与引用

事件形状为 `{schemaVersion:2,turnId,sequence,kind,data}`，`kind` 为 status、answer_delta、citation 与 terminal；正文增量、引用与终态均携带 `answerVersion`。断线后以 `afterSequence` 继续，客户端按 `sequence` 去重；断线和关闭面板不停止任务。轮次快照只投影当前版本的回答、引用、质量判决、执行过程与最后事件序号。

回答中的引用只能指向本轮已验证并被选用的证据；未知、未选用或未闭合的引用标记使本轮以 `CITATION_INVALID` 失败。合法引用只证明来源，不证明回答语义正确。证据跳转分别使用 `GET /conversations/:id/location` 与 `GET /turns/:id/evidence/:evidenceId/location`，服务端再次核对当前文件版本。执行过程（`process`）是已提交状态事件的有序投影，包含实际检索、读取与检查记录；不包含模型临时推理、系统提示词或凭据。

## 错误与终态

书籍文件或提取版本变化会冻结会话。无权限或不存在返回 404；活动轮冲突、版本变化、重复命令负载不一致、协议或答案版本不匹配返回 409；非法选区与请求字段返回 400。资源耗尽、无进展、输入超限、模型或索引失败均保留已发布的部分回答与可追溯终态，不能当作成功答案。停止立即提交 `cancelled`；进程中断后未完成的轮次标记为失败，不自动续跑，重试需要用户创建新轮次。
