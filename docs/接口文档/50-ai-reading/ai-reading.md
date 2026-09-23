# AI 阅读与单书连续会话

- 基础路径：`/api/v1/ai-reading`
- 鉴权：HttpOnly 服务端会话 Cookie
- 前置：用户已配置模型，目标书的 Catalog 正式 `BookReadingProfile.primaryGenre !== null`
- 通用成功信封：`{ code, message, data, requestId, timestamp }`
- 当前代码：`src/modules/ai-reading/`。Application 只依赖本模块 Port，外部模型与书籍能力由 Infrastructure Adapter 接入；该目录迁移不改变路由、DTO、SQLite Schema 或错误响应。

## V2 会话边界

`/conversations` 是唯一 AI 阅读业务入口。每个 turn 都关联一个新的 `schema_version=2` ReadingTask 和独立预算，task/root Agent 的执行 goal 等于本轮 `userInput`；conversation 的 `rootGoal` 仅作为跨轮原始意图进入有界上下文。任何终态 task 都不会为了追问或 retry 重开。旧 `/tasks*` 路由已删除并由框架返回 404，不提供转发或兼容期。

会话固定单书、`contentRevision`、根目标和首轮正式画像快照。同一 revision 下继续使用冻结的 `profileId/profileVersion/confidence kind`、分类和 traits；人工画像可以准入，不要求 `modelId`、`strategyVersion` 或 AI 数值置信度，兼容字段 `strategyVersion` 可为 null。未确认的 BookAnalysis 候选不参与准入或快照。正文 revision 变化后会话永久 `frozen`，历史仍可读，但必须为新版正文新建会话。

## 模型与预算

| 方法 | 路径 | 用途 |
|------|------|------|
| GET/PUT/DELETE | `/model-config` | 读取公开配置、保存/更新、删除；API Key 不回传 |
| POST | `/model-config/test` | 使用提交值或已存配置做 15 秒连接测试 |
| GET | `/budget-config` | 返回 `version: 2`、quick/standard/deep、六项自定义约束和只读 executionLimits |

`model-config*` 的 URL 仍属于本基础路径，但 Controller、DTO、配置 UseCase 和唯一配置 Repository 位于 `support/ai-model/`；`budget-config`、conversation 和 turn 仍由 AiReading 处理。这个归属变化不改变 HTTP 方法、状态码、成功信封或 DTO 校验。

AI 阅读与书籍预分析依赖 strict Tool calling，因此不接受 `deepseek-reasoner` 或名称中含独立 `r1` 段的 reasoning 模型。保存这类配置返回 `400 / 40002` 且 `details.reason=DEEPSEEK_MODEL_UNSUPPORTED`；连接测试返回 `ok=false` 和同名 `errorCode`，不会向 DeepSeek 发请求。已有不兼容配置在创建 conversation 或 turn 时同样被准入边界拒绝。

当前公开配置仍只有 `provider: "deepseek"`。业务调用经 provider-neutral Gateway 路由；未知 provider/profile fail-closed，本期没有 OpenAI、Anthropic 或其他 Provider 契约。

当前采样与输出上限由服务端按用途固定：Tool Agent 循环为 `temperature=0.2/max_tokens=16384`，最终答案流为 `0.6/16384`，书籍预分析分类为 `0/16384`，连接测试为 `0/4096`，客户端不能覆盖。Tool 请求没有返回 Tool call 且 `finish_reason=length` 时，服务端以独立的 `MODEL_OUTPUT_TRUNCATED` 进行一次有界恢复，不占用纯文本 `MODEL_TOOL_OUTPUT_REQUIRED` 的修复机会。

创建 conversation 或 turn 可提交 `budgetTier`，也可额外提交完整 `budgetPolicy`。自定义 policy 必须一次提供 `maxModelTurns/maxToolCalls/maxReadCharacters/maxDurationMs/maxDelegatedAgents/maxConcurrentAgents`，并满足委派总数与并发一致性约束。

默认档位如下；显示中的时限单位为分钟。委派总数、子节点并发和最大深度随档位缩放，且仍受服务级最大深度和每层最多 3 个节点限制。

| 档位 | 模型轮次 | Tool 调用 | 阅读字符 | 时限 | 委派 / 并发 / 深度 |
|---|---:|---:|---:|---:|---:|
| quick | 60 | 90 | 250,000 | 30 | 0 / 0 / 0 |
| standard | 90 | 135 | 500,000 | 45 | 2 / 2 / 1 |
| deep | 120 | 180 | 750,000 | 60 | 6 / 3 / 2 |

每个 turn 有独立 task 硬预算；会话 `usage` 仅汇总所有 turn 的 `promptTokens/completionTokens/totalTokens`，不设置会话级硬上限。

## Conversation API

| 方法 | 路径 | 请求/用途 |
|------|------|-----------|
| POST | `/conversations` | `{bookId,message,budgetTier,budgetPolicy?,readerFocus?}`，原子创建会话、首 turn、V2 task/budget/root run |
| GET | `/conversations?bookId=&page=&pageSize=` | 当前用户单书会话分页，含累计 token usage |
| GET | `/conversations/:conversationId` | 会话、最近 turn、分页标志和 usage |
| DELETE | `/conversations/:conversationId` | 无活动 turn 时硬删除整个会话及关联 task 数据 |
| POST | `/conversations/:conversationId/turns` | `{message,budgetTier,budgetPolicy?,readerFocus?}`，创建追问 turn |
| GET | `/conversations/:conversationId/turns?beforeTurnNumber=&pageSize=` | 按 turnNumber 向前分页 |
| GET | `/conversations/:conversationId/turns/:turnId` | turn 及关联 task detail/Agent 树 |
| GET | `/conversations/:conversationId/turns/:turnId/events?afterSequence=&limit=` | 该 turn 的公开事件增量分页；跳过全局限流 |
| POST | `/conversations/:conversationId/turns/:turnId/cancel` | 取消该 turn 的 task 和全部非终态 AgentRun |
| POST | `/conversations/:conversationId/turns/:turnId/retry` | failed/cancelled 专用；`{message?,budgetTier?,budgetPolicy?}` 创建新 turn/task，省略 message 时复用原输入；返回受限 `retrySource` |

`readerFocus` 为 `{sectionIndex,chapterLabel?}`。后端以 sectionIndex 为权威并按当前 BookScope TOC 解析最具体章节的 start/end Locator；chapterLabel 不参与可信定位。无法解析时模型上下文标记 unresolved，并可通过 `request_clarification` 使 turn 进入 `needs_input`。

同一 conversation 最多一个 `queued/running` turn；全服务最多两个活动 conversation turn。不同会话可并行。不能单独删除 turn；整个会话有活动 turn 时 DELETE 返回 409。

## 状态与语义

Conversation 状态：`active | frozen`。

Turn/ReadingTask 终态：`completed | partial | needs_input | failed | cancelled`。`needs_input` 保存 `clarificationQuestion`，用户回答通过创建下一 turn 继续，不重开旧 task。failed/cancelled 的 retry 同样创建新 turn/task/budget 并记录 `retryOfTurnId`。重试 turn 的 `retrySource` 只投影来源 turn/status、稳定 `failureCode` 及至多 20 个可重放证据候选；候选只含 `sourceEvidenceId/chapterPath/quotePreview`，quote preview 最多 240 字符，不返回 source Locator、hash、上游错误正文或 transcript。

“解释上一条”“换个角度”“引用依据”等追问通过有来源 checkpoint 继承稳定结论；需要旧证据时由内部 Tool 重放正文并生成当前 task 的新 evidenceId。“继续读这一章”优先使用本轮 readerFocus，其次稳定 checkpoint 的章节范围；仍无法解析则请求澄清。

## Agent 树与执行限制

- 根 Agent 深度 0；quick 禁止委派，standard 最大深度 1，deep 最大深度 2。每个父节点最多三个子节点、每层最多三个委派节点、每个节点只委派一次。
- standard 子节点最多 6 模型轮、9 Tool、32,000 读取字符；deep 子节点最多 8 模型轮、12 Tool、48,000 读取字符；两者均为 180 秒实际执行时间。V2 单次 DeepSeek 调用上限为 120 秒。
- `delegate_reading` 只在当前节点存在至少两个独立未完成清单单元、深度和总量允许、且剩余预算覆盖子任务及父节点收敛时开放。同一模型响应中的一个 delegate 可与状态维护 Tool 共存，Host 固定先维护状态；多个 delegate 或与 Reader/终态 Tool 混合仍拒绝。
- 根/子节点均预留至少一次完成模型轮与完成 Tool。进入预算尾段且已有 Evidence，或清单已完成时，不再开放扩大阅读范围的 Tool。根节点已有 Evidence、计划基线至少完成一项且有效阅读批次达到 quick/standard/deep 的 4/8/12 批时，也进入覆盖饱和收敛；该阈值不是 Citation 数量门槛，单段密集 Evidence 不会单独触发。
- 父节点等待所有直接子节点终态后恢复，只接收结构化 ChildRunResult，不接收子 Agent transcript。
- task detail 的 `agents[]` 返回 `id,parentRunId,kind,depth,goal,deliverable,status,usage,limits,terminalReason`，供前端构树，不包含模型消息或内部提示词。
- task detail 的 `budget.used` 和 `agents[].usage` 在既有字段外可兼容新增 `cacheReadInputTokens/cacheWriteInputTokens/uncachedInputTokens: number | null`。DeepSeek 分别映射 cache hit、未报告 cache write、cache miss；NULL 表示 Provider 未报告，不能当作零命中。既有 conversation `usage` 仍只汇总 prompt/completion/total。

## 显式连续阅读与上下文

- 一个模型 `book_read`/`book_read_from_toc` Tool call 对应一次 BookContent 调用、一次 Tool/正文预算结算和一个 Tool Result。Host 不再隐藏执行 4,000 字分页或合并 16,000 字批次。
- `book_read` 默认 4,000、最大 50,000 字符；forward/backward 可在一次调用中跨多个 section，around 只扩展当前 section。结果使用 `segments[].citation`，每个 segment 再按最多 1,500 字符生成 Evidence。
- `book_read_from_toc` 首次接收 `{ nodeIds }`（1–200 个当前节点），续批仅接收 `{ cursor }`，二者互斥。按书内顺序去重并消除父子范围重叠；超过 50,000 个规范化 UTF-16 字符的父节点递归拆为自身正文范围和子节点，每批最多 50,000 字符及 200 个处理单元，完整单元不截断。无法再拆的超大单元记入 `unavailable`（`TOC_NODE_TOO_LARGE`），空单元记为 `TOC_NODE_NOT_READABLE`，其余可读单元继续返回。没有 `book_read` recovery 或摘要委派。`continuation.next` 原样传给同一个工具；cursor 绑定书籍、revision、规范化选择和批次边界。
- 目录批次预算由 `planTocRead` 预检，按实际返回正文结算；上下文或预算不足时停止，不截断单元。模型收到完整单元和不可读缺口；checkpoint 的 `tocRead` 以成功批次验证累计覆盖。公开 tool_observation 包含 characterCount、segmentCount、citations、unitCount、unavailableCount、coverage 和本批受限 unavailable 摘要。
- 新 checkpoint 只用 `readingState` 保存覆盖与 continuation，不写 `pendingBookReadBatch`。恢复旧字段时清除隐藏分页状态并重放原始显式 Tool call，不续接半完成批次。相同起终点返回 `READING_TARGET_ALREADY_REACHED`，不创建空 Evidence。
- 每个节点的第一个有效计划形成不可删除基线；后续只能单调推进、追加，或携带明确 `replacementReason` 替换描述。计划与探索覆盖状态均进入 checkpoint，恢复后继续执行同一约束。
- scheduler 遇到瞬时 SQLite busy/locked 时结束当前轮询并在下一 tick 重试，不改变 checkpoint、lease fencing 或公开事件；其他异常仍按原错误路径抛出。
- 每次模型请求按 messages、实际 Tool schema 和模型 profile 估算输入，应用上限为 128,000 token并预留最多 16,384 输出 token。显式 `book_read.maxChars` 会按剩余输入余量动态向下钳制；最新未消费 Tool Call/Result 保留。仍超限时以 `CONTEXT_BUDGET_EXCEEDED` 终止，有证据为 partial，无证据为 failed。

## Checkpoint 与证据所有权

不可变 ConversationCheckpoint 最大 20000 字符：最近 6 个 turn 摘要、20 finding、10 preference、20 topic、10 open question、20 plan step、6 chapter range 和 48 source evidence ref。completed/partial/needs_input 可推进稳定 checkpoint；failed/cancelled 不推进。

旧 turn 的 evidenceId 不能直接用于当前 task 完成结果。内部 `conversation_import_evidence` 只对第二轮起的根 Agent 开放，且不属于公共 MCP：

1. 校验同用户、同会话、同书、同 revision；普通来源必须为 completed/partial/needs_input，failed/cancelled 仅当目标 turn 的 `retryOfTurnId` 精确指向该来源时可显式导入。
2. 校验 evidence 归属来源 task 且具有 V2 `sourceLocator`。
3. 通过 BookContent 精确重放 source range，核对 quote/hash。
4. 为当前 task 写新 evidenceId 和 `conversation_import/sourceTaskId/sourceEvidenceId` provenance。
5. 导入的 Tool 调用和读取字符计入当前节点及 task 预算。

关闭 `AI_READING_CONVERSATIONS_ENABLED=false` 时，所有 `/conversations` 路径统一返回 404 `CONVERSATIONS_DISABLED`，不存在 V1 回退路径。

最终结果仍只能引用当前 task 拥有的 evidenceId。Citation 保存 quote、完整 Locator、revision 和正文 hash；同 revision 可返回原文，frozen 会话不得向新版 EPUB 伪定位。V2 task detail 的 `result.answerText?` 是已完成的连续回答正文；其余 `bookFindings/inferences/modelKnowledge/openQuestions/limitations/evidence` 结构保持不变。

## 公开事件

`ai_reading_events` 是唯一 UI 事件源。除既有 task/plan/tool/evidence/agent 事件外，V2 还包括：

- `agent_queued`
- `agent_waiting_children`
- `agent_resumed`
- `agent_progress`
- `evidence_imported`
- `answer_started`
- `answer_delta`
- `answer_completed`
- `task_needs_input`

`agent_progress` 在非终态 Tool call 前发布，`payload.kind=commentary`，`detail` 为 `{ phase: "completed", text }`。`text` 是模型主动面向用户生成的简短中文执行说明，最多 1200 字，会做凭据形态清洗；它不是 `reasoning_content` 或隐藏思维链。客户端按 sequence 将其与 Tool、计划和恢复事件交错展示。终态 `complete_turn/complete_subtask/request_clarification` 所附正文不投影为 progress，避免与最终答案重复。

答案事件使用相同的 sequence 增量分页：`answer_started.detail` 给出 `answerId/mode`，`answer_delta.detail` 给出 `answerId/offset/delta`，`answer_completed.detail` 给出最终 `text/characterCount/evidenceIds/mode`。单个 delta 最多 2000 字，完成全文最多 8000 字；客户端必须以最新 `answer_started` 的 answerId 为边界，按 offset 重放，并以 completed 全文校正结果。`mode` 为 `model | fallback`，fallback 表示模型流不可用时由已校验结构化结果确定性生成，并不降低证据所有权要求。流式请求在首个 delta 发布前遇到 429、5xx 或网络故障最多尝试 3 次；发布 delta 后不再重试，若随后中断，服务端会发送一个新的 fallback answerId，客户端必须替换旧的半截 model answer。

`conversation_import_evidence` 成功会使用同一 `toolCallId` 依次写入 `tool_observation` 与 `evidence_imported`。历史任务可能只有 `evidence_imported`；该事件已经证明导入成功，客户端不得因为缺少 observation 将其显示为失败或中断。

公开 payload 只允许状态、目标摘要、depth/parent、usage、清洗后的执行说明、白名单 Tool 参数/结果摘要、证据 ID、最终回答和稳定错误码。前端可把这些事件展示为“执行过程”，但不得称为模型原始思维链。内部 messages、audit、Pino、system prompt、reasoning、书籍完整正文、凭据、完整上游响应和敏感调试日志均不属于该 API。

`complete_turn/complete_subtask` 引用不属于当前 task 的 evidenceId 时，第一次返回可恢复的 `EVIDENCE_NOT_OWNED` Tool 结果，模型专用字段仅包含 `invalidEvidenceIds`、当前 task 最多 100 个 `availableEvidenceIds` 和稳定 `suggestedAction`；同时发布失败 Tool observation 与 `recovery_attempted`。同一 Agent 第二次仍引用无效 ID 时终止，所有权校验不会降级。

## 稳定业务错误

| reason | 含义 |
|--------|------|
| `CONVERSATION_TURN_ACTIVE` | 同一会话已有活动 turn |
| `AI_READING_TURN_CAPACITY` | 全服务已有两个活动 V2 turn |
| `CONVERSATION_FROZEN` | 会话已冻结 |
| `CONVERSATION_REVISION_CHANGED` | 当前书正文 revision 与会话不一致；会话同时被冻结 |
| `TURN_NOT_RETRYABLE` | 来源 turn 不是 failed/cancelled |
| `CONVERSATIONS_DISABLED` | V2 会话 API 被配置关闭 |
| `REFERENCE_UNRESOLVED` | reader focus 无法解析到可信章节范围 |
| `DEEPSEEK_MODEL_UNSUPPORTED` | 配置或任务使用了不支持 Tool Agent 的 reasoning 模型 |
| `MODEL_OUTPUT_TRUNCATED` | 模型连续两次在生成 Tool call 前达到输出上限；已有证据的 V2 根任务按 partial 收敛 |
| `CONTEXT_BUDGET_EXCEEDED` | 压缩后仍无法同时容纳输入、Tool schema 和 16,384 输出预留；已有证据时按 partial 收敛 |

Book analysis 准入仍返回 `BOOK_ANALYSIS_REQUIRED/IN_PROGRESS/FAILED/UNSUPPORTED`。内部委派、预算、fencing 和 evidence import 错误以稳定 errorCode 写入受限事件或节点 terminalReason，不回显上游原始错误正文。

## MCP 与模型投影

REST/MCP BookContent UseCase、完整 EvidenceLedger、内部 `ModelToolResultPresenter` 和 conversation Tool 是四个不同边界。Reader Tools 读取契约已统一为 segments 与 50,000 字上限；conversation Tool 不导出到 MCP。未来跨书 Agent 的显式 bookId/allowedBookIds 仍由 Adapter 和任务授权层注入，不下沉到领域层。

内部六个阅读 Tool 的模型可见描述以 `ModelToolResultPresenter` 为事实源，声明选择边界、分页/批量限制和实际返回字段。14 个不同 V2 Tool 定义当前保守估算为 4,391 token，低于 10K 回归门槛；A9 `input_examples` 尚未实现。
