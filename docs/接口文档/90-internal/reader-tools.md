# Reader Tools

- 基础路径：`/api/v1/reader-tools`
- 鉴权：普通会话 Cookie，或带所需 scope 的 `rew_ai_` AI Access Token
- 当前正文格式：EPUB；所有读取都校验用户归属和 `ContentRevision`
- HTTP Controller/DTO 位于 `src/interface-adapters/reader-tools-http/`；确定性内容 UseCase 位于 `src/modules/intelligent-library/book-content/`，模块外通过 IntelligentLibrary `public/BookContentAccessPort` 调用。metadata 批注统计和批注候选查询通过 ReadingState `AnnotationQueryPort` 在外层组合。BookContent 抛出的纯模块错误由该 HTTP Adapter 映射回下述既有 status/code/details。

| 方法 | 路径 | 最低 AI scope | 用途 |
|------|------|---------------|------|
| GET | `/library` | `books:read` | 有界搜索私人书架 |
| GET | `/books/:bookId/metadata` | `books:read` | 元数据、格式、revision 和目录能力 |
| POST | `/books/:bookId/toc` | `books:read` | outline/tree/navigation 目录视图 |
| POST | `/books/:bookId/read-from-toc` | `books:read` | 按多个 TOC 节点进行结构分页读取 |
| POST | `/read` | `books:read` | 按 Locator 向前/向后/围绕命中读取正文，可携带目标 endLocator |
| POST | `/books/:bookId/search-text` | `books:read` | 精确文本搜索，返回候选 Locator |
| POST | `/books/:bookId/search-semantic` | `books:read` | 语义搜索；未配置索引时明确返回 `INDEX_NOT_CONFIGURED` |
| POST | `/books/:bookId/annotations` | `books:read` + `annotations:read` | 读取用户批注作为候选证据 |

响应包含可重放 Locator、Citation、分页/截断和边界信息。MCP 对外 Tool Schema 见 `backend/reader-tools-mcp/README.md` 与根目录 `doc/AI阅读助手/阶段0-Tool契约草案.md`；内部 DeepSeek Agent 的精简模型投影不改变这里的公共契约。

`GET /books/:bookId/metadata` 的 `contentStats.tocQuality` 表示目录到正文的映射质量：`declared` 为原书目录可直接使用，`declared_repaired` 为声明目录的位置或层级已确定性修复，`spine_fallback` 为声明目录无法安全修复后退回 EPUB spine。当前抽取版本为 `epub-extractor-v5`，规范化为epub-source-map-v2，共享Foliate核心与前端同源：已有嵌套目录优先；完全扁平的声明目录只在节点可确定映射到正文 `h1…h6` 时按标题级别建树，不使用编号或 LLM 推断。详细来源与计数保存在内部 `BookDocument.tocProvenance` 并由 Inspector 展示；公共 `tocQuality` 仍保持三值。旧缓存、nodeId、Locator、continuation 和依赖旧 revision 的画像会自然失效。

TOC `navigation` 视图为每个选中节点返回完整公共 `startLocator` 和 `endLocator`。`startLocator + direction=forward` 从章首读取；`endLocator + direction=backward` 可直接读取章尾。两者都是导航点，正文证据仍以随后 `book_read` 返回的 `read_context` Citation 为准。

`book_read_from_toc` 首次接收 `{ nodeIds }`（1–200 个当前节点），续批仅接收 `{ cursor }`，二者互斥。按书内顺序去重并消除父子范围重叠；超过 50,000 个规范化 UTF-16 字符的父节点递归拆为自身正文范围和子节点，每批最多 50,000 字符及 200 个处理单元，完整单元不截断。无法再拆的超大单元记入 `unavailable`（`TOC_NODE_TOO_LARGE`），空单元记为 `TOC_NODE_NOT_READABLE`，其余可读单元继续返回。没有 `book_read` recovery 或摘要委派。`continuation.next` 原样传给同一个工具；cursor 绑定书籍、revision、规范化选择和批次边界。

返回 `text + segments + units + unavailable + continuation + coverage`。每个 units 项含 `unitIndex/nodeId/label/kind(subtree|own)/normalizedCharCount/startLocator/endLocator/textStart/textEnd/boundary/complete`；unavailable 项含同样的范围身份及 `reason/message/maxCompleteChars`，没有正文偏移或 Evidence。节点之间可能有未选正文或不可读缺口，不能把顶层 text 当成连续原文。

`coverage` 含 `selectionId/selectedNodeIds/totalChars/returnedChars/pendingChars/unavailableChars/unavailableUnits/processedUnits/totalUnits/complete`。REST/MCP 的 returnedChars 是按 cursor 进度计算的累计返回规模，不证明调用方曾消费之前的批次；内部 Agent 另外依据成功读取记录验证。只有批次耗尽且没有不可读单元时结构规划 complete 才为 true。每批 unavailable 只列出本批处理的失败单元，coverage 的不可读统计覆盖整个选择；即使全不可读，也返回 201 成功信封中的结构化结果，text/segments/units 为空，complete=false。

旧 nodeId、maxChars、direction 和字符偏移参数均拒绝。cursor 最长 300,000 字符；失效或非规范批次位置返回 CURSOR_INVALID，未知 nodeId 返回 TOC_NODE_NOT_FOUND，结构重叠或字符统计不一致返回 EXTRACTION_FAILED。

生产 `mode=tree` 继续限制为最多 200 个 TOC 节点并返回 `TOC_TREE_TOO_LARGE`；本地 BookDocument Inspector 可在明确标注 `Inspector-only bypass` 后使用同一 tree builder 查看完整树，这不是生产接口能力。

`POST /read` 接收 `{ locator, endLocator?, direction?, maxChars? }`。`maxChars` 默认 4,000、范围 200 至 50,000。`endLocator` 是连续阅读意图的目标边界，只能与 forward/backward 组合；around 携带 endLocator 返回 `LOCATOR_INVALID`。forward/backward 一次调用可跨多个可读 EPUB section，直到字符上限、目标边界或书籍边界；around 只在焦点 section 内展开。起点已经等于目标时返回可恢复的 `READING_TARGET_ALREADY_REACHED`。

`book_read` 的连续范围响应返回：

- 顶层 `previousLocator/nextLocator` 和 `reachedSectionStart/reachedSectionEnd/reachedBookStart/reachedBookEnd`，供既有 REST 调用方兼容。
- `continuation.previous/next`，每项为可直接作为下一次 `/read` body 的 `{ locator, endLocator?, direction, maxChars }`；`maxChars` 保留本次服务端实际采用的值，避免续读退回默认 4,000。到达所选目标边界后对应方向为 null。
- `segments[]`，每项含拼接后 `text` 内的 UTF-16 `[textStart,textEnd)` 和该 section 连续片段唯一的 `citation`。跨 section 读取不会伪造一个覆盖多 section 的单数 Locator。

上述顶层裸 Locator、reached 字段和 boundary 仅属于 `book_read`；目录批次只在 units 内给出边界。两种读取的 Citation 都只证明对应 segment 的已读正文。MCP 目录读取显式传 bookId，内部单书 Agent 的 BookScope 在服务端注入。

## 选区问答结构能力边界

既有Reader Tools REST/MCP路由和完整目录单元/continuation契约保持；新问答的book_toc、book_read_from_toc、book_read_node是SelectionQA自有模型工具，消费IntelligentLibrary公开BookStructuredContentPort，不新增同名REST路由。前者经outline分页取得长目录，后两者完成强证据桥接及明确节点续读；不能把旧字符Locator/TextQuote直接当作问答完整CFI证据。

BookContent范围归属现按跨section节点边界及最深包含节点计算；问答的结构请求贯穿signal/deadline，CONTENT_CANCELLED映射409/40916，期限沿INDEX_DEADLINE映射408/40811。无问答会话覆盖状态进入BookContent；单次返回、跨调用覆盖与语义充分性分开。
