# 共享 EPUB 核心

`@readeverywhere/epub-core` 是 Web EPUB 阅读与 Node BookContent 的唯一受控解析源码。前端分页/overlayer 仍留在 Foliate 浏览器目录；包内只共享 EPUB 结构、CFI、章节 DOM 解析、字节解码和规范定位。阶段证据统一维护在[实施计划](../../doc/AI阅读助手/选区问答与统一EPUB定位实施计划.md)。

## 安装与验证

Node 24+。在本目录 `npm ci`；前后端各自通过 `file:../../packages/epub-core` 安装本包。运行：

```sh
npm test
npm run typecheck
npm run verify:hosts
npm run verify:documents
npm run benchmark
npm run fixtures
```

`verify:hosts` 仅监听随机本机端口，Node DOM 在可终止 worker 中，Chromium 比较原始章节、Foliate Loader Blob、sandbox iframe 以及真实 paginator 样式注入后的正文、源端点与旧 CFI。需要前端 Playwright Chromium。`verify:documents` 运行原 Inspector 人工目录 gold 与诊断硬不变量；切换前新旧提取器比较的历史数据保留于 `test/pre-switch-comparison.json`，脚本不再保留或重跑旧解析算法。

`capture:baseline` 使用前后端已构建产物、本机 5199 预览及 HTTP mock，保存桌面/手机书架、Toolbar、阅读器与旧 AI 面板。它不启动数据库、不调用模型，不代表完整业务 E2E。报告/EPUB/截图写入 gitignore 排除的 `reports/`。

## 出口与约束

- 包根：`parseChapter`、紧凑 `buildSourceMap`、双向范围转换、`resolveSelection`、`canonicalOffsetAtElement`；DOM 由宿主传入，不访问 ZIP/网络、不执行脚本。
- `/types`：不依赖 DOM 的纯数据声明；`/node`：`parseEpub`、`resolveEpubSelection` 和 Node Port 类型。前端不要引入 Node 出口。
- `/foliate/epub.js`、`/foliate/epubcfi.js`：原仓库同版本引擎子集，唯一源码，无旧路径兼容副本。
- `/decode`：按媒体类型对 XML/HTML/CSS 编码声明做有限 prescan，BOM优先（不声称完整浏览器sniff），UTF32/非法bytes或label拒绝；Node ZIP、Web ZIP/目录与章节加载采用相同入口。
- Node 在 jsdom 默认禁止脚本/资源加载的独立 worker 中解压与解析。交互 lane 单并发、最多 8 排队；超时从提交时计算，排队 abort 即刻移除，终止 worker 完成后释放槽位。默认 30 秒，worker old-generation 上限 384 MiB，不是整进程 RSS 保证。
- ZIP 只在内存读取，维持原 5000 条目/单条目解压 50 MiB/总解压 200 MiB 上限；拒绝危险路径、重复路径、大小不一致、缺失 spine 资源。没有新增压缩输入 50 MiB 限制。资源不落盘、不请求网络。
- `resolveEpubSelection(bytes, expectedScope, request)` 接受源节点范围或完整书籍 CFI，校验实际文件 SHA-256、物理 spine/规范 href、版本与精确 displayedQuote，返回 canonicalQuote 和范围；不搜索 quote，不跨版本恢复。调用方必须先取得当前 artifact 的权威归属/版本 scope；该函数不能代替用户授权，也不能代替写批注事务内版本 fencing。
- worker 错误传递 `{ name, code, message }`，保留稳定定位错误码，不向消费者传堆栈。P1 不新增 HTTP 问答接口、持久化 source map 或数据库结构。

## 规范化版本

当前 `epub-source-map-v2`，生产提取器 `epub-extractor-v5`。NFC 跨 inline 节点；普通空白折叠；块间单换行，含表格单元格；pre/code 保留原空白；图片 alt/块分隔为合成文本；排除 script/style 等。旧 `epub-text-v1` 正文偏移不可混用，新 revision 自然隔离旧缓存/引用；旧批注 CFI 与数据不改写。

source map 用 Uint32 列式记录和同节点恒等区间压缩，特殊 NFC/字素/空白保留独立 provenance。拒绝合成端点、emoji/组合字素内部、折叠空白内部、逆序/空范围。字素规则依赖宿主 Intl.Segmenter，当前测试记录 Node/ICU/Chromium 版本；跨 ICU 版本不是无条件兼容承诺。

后端目录沿用 NCX 优先、原扁平目录修复/标题层级推断；Web 仍 nav 优先。二者使用相同目录结构解析函数，标签选择是明确的消费策略，正文/资源坐标不受标签差异影响。

第三方来源、许可证及补丁清单见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

## 关键词索引 worker

`./keywords` 提供带运行Unicode版本的位置预分词算法和有界查询规范化；`./node` 提供 `buildEpubIndex`（16块ack背压）、`replayEpubRanges`、`readEpubContext` 和 `expandEpubEvidence`。索引lane单并发/2排队，交互lane单并发/8排队；deadline从提交起算。

分块版本 `epub-chunks-v2-structure-800-1200-soft1600-scope2-icu<版本>-unicode<版本>` 利用原始DOM文本归属识别段落、标题、列表项、引用、pre和表格。短单元按同小节装箱，目标800–1200规范UTF-16字符，完整单元可放宽至1600；标题及进入、离开显式 section/article/aside/nav 建立新的小节边界。超长段落用 `Intl.Segmenter(und, sentence)` 拆句，超长表格先按行、代码按换行，再按安全源端点拆分超长单元。只有完整的短单元（≤200字符）可重叠，不使用固定字符后退；不重复输出纯重叠尾块。超长单句/行的强制切分通过 `boundaryTruncated` 标记；连一个规范化字素都无法容纳时明确失败。ICU/Unicode版本进入chunker身份，升级会构建新派生索引；正文规范化版本不变。无法引用的合成区间显式unavailable，canonical quote与DOM displayedQuote分别保留。

`expandEpubEvidence(bytes, scope, rankedHits, {maxChars,maxWindowChars,limit,timeoutMs,signal})` 在一个交互worker内批量验证并扩展命中：所有输入原范围的hash/CFI必须匹配，传入quote/displayedQuote时也严格校验。补齐命中所在段落，按预算前后扩展同小节完整邻段；长段可补齐包含端点的完整句子并加入邻句。合并可容纳的重叠连续窗口，保持最高命中排名，去重后用后续候选补足，返回最多limit（≤5）条且累计正文≤maxChars（≤24000）。窗口最多12000字符；预算不足时减少扩展或跳过无法完整容纳的命中，调用方必须区分预算不足与无检索结果。每窗重新构造source/CFI/quote/hash，并带检索来源 `hitRanges`；这些是诊断元数据，不改变原文。`contextTruncated` 表示不能补齐结构/句界或预算回退到命中范围，不表示窗口未覆盖全章。`replayEpubRanges` 继续只做精确原范围回放，绝不隐式扩展。

模型已经选定候选时，使用 `preserveAllHits: true`：输入数必须≤limit，且此模式 limit 最多12（默认自动筛选模式仍最多5）；先为所有原命中长度保留预算，再按输入排名分配扩展余量；每个命中各返回一个包含完整原范围的窗口，不进行80%近似重叠去重，重叠窗口仍分别计入字符预算。总原范围长度或单范围长度无法满足预算时返回 `CONTEXT_BUDGET_EXHAUSTED`，不静默丢选中项；hash/CFI/quote验证不变。默认 false 保留候选池自动筛选模式。

位置分词版本为 `rew-keywords-v4-han-unigram-tech2-boundary1-unicode<运行Unicode版本>`。NFC/lowercase后逐汉字码点输出，不使用Intl、领域词典、bigram或停词删除；保留重复出现、标点/空白分隔位置。拉丁技术词如I/O、C++、C++17、Node.js、UTF-8保持原子，UTF8 hex防止底层unicode61再次拆分技术符号。Unicode数据版本入索引身份；不再使用Intl词典，因此不因ICU词切分变化而失效。

`prepareKeywordQueries`每个内层字符串代表一个有序短语，内部token以空格连接且不去重。输入字符串的空白分隔完整词面，每条最多128 UTF-16、16个词面，最多4条/共512 UTF-16；已移除96唯一token限制。相同完整词面可去重。词面由调用方提供，核心不从完整自然句推断术语。`tokenizeKeywords(text,isQuery)`保留签名，索引/查询输出相同的位置流。

查询策略 `phrase-or-bm25-v1` 在单书单代FTS中组合完整短语；正式默认等权OR，查询期可对照权重与最少匹配词面数。它们不影响索引身份。发布、恢复和范围重叠去重见 [BookContent](../../backend/map/30-intelligent-library/book-content.md)。位置正确性不等于语义相关性，尚未宣称中文问答质量全面解决。

索引专属预算为压缩64MiB、单spine声明解压2MiB、spine合计8MiB，索引oldGen默认192MiB；交互oldGen默认384MiB。RSS默认1200MiB/25ms轮询是尽力保护，不是硬隔离，且不更改导入/阅读准入。所有超限明确失败。`node test/index-budget.mjs` 是可复跑的自制大书双lane资源探针；业务权限、artifact fencing与持久化由BookContent负责。

选区解析、上下文读取与引用回放仅为目标章节创建 DOM/source map，完整提取和索引仍遍历全书。`readEpubContext` 的 cap 与问答契约统一为最多 12000 个规范 UTF-16 字符；与检索扩展共用结构和句界规则，保留整个原选区并优先补齐所在句段；返回显式布尔值 `contextTruncated`，长单句或代码行无法容纳时在预算内按精确源端点补充邻近正文并标为不完整，不退化为只返回几个选中文字；范围必须完整容纳于 cap，不能静默截断，超出章节长度返回 `RANGE_OUT_OF_BOUNDS`。

Node 内存预算读取运行环境：`EPUB_INDEX_RSS_LIMIT_MIB=1200`、`EPUB_INDEX_HEAP_LIMIT_MIB=192`、`EPUB_INTERACTIVE_HEAP_LIMIT_MIB=384`。仅接受正整数MiB；两个堆上限须小于RSS阈值。每次worker启动时读取，非法配置直接失败。堆限制不包含Buffer等外部内存，RSS是全进程指标，容器硬上限必须额外留余量；现有Docker档位显式覆盖为800MiB并配套1GiB硬上限；提高软阈值时应同步匹配容器硬限制。并发/ZIP大小准入不随内存档位变化。
