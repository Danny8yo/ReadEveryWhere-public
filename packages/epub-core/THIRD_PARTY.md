# 第三方来源

共享引擎来自本仓库原 `frontend/src/lib/foliate-js/{epub.js,epubcfi.js}`，已迁移至 `src/foliate/` 唯一来源，没有下载升级上游或保留旧路径副本。MIT 原许可证保留于 `LICENSE.foliate`，原作者 John Factotum。仓库引入commit为`5f4691d`，vendored package版本`0.0.0`不代表上游发布版本。

## 可审计哈希

P0修复前epub.js SHA-256：`dfe347495039e9b5991478986ec6b7713cf9efbcd8f475a77ef7b967c5176298`。
P0修复后epub.js：`da82996dcc2a51d2e95330b8e5ffd2abb8cad641f82eb15e8b2a6470ad887d26`。
P1当前SHA-256：

- `src/foliate/epub.js`：`c36225cf0f29296edf9387169b371ead0fcb6c3480b0ff9935e3c5cdc40aac3a`
- `src/foliate/epubcfi.js`：`e1a688ad5c84bf31f33cef467f92c7a6d060a0f17ec37c1d3c048e9c7b1cf645`（原CFI算法未改）
- 浏览器宿主 `frontend/src/lib/foliate-js/view.js`：`05e070a83479ca11a44c6876ce6e0b2363a55905c4a8a7980df50922d623038d`

## 本地补丁

- 统一createDocument/显示Loader的XHTML→HTML解析规则，调用共享`parseChapter`，不改manifest media type。
- 公开原Resources/parseNav/parseNCX，提取双方共用loadPackage；Node不要求运行浏览器metadata或分页。HTML fallback下nav支持普通epub:type/type/role属性。
- ZIP/目录Loader读取原字节并调用同一媒体类型解码器，EPUB加载向loadText传mediaType。decoder为有限XML/HTML/CSS声明prescan，BOM优先；不声称完整浏览器sniff，UTF32及非法bytes/label明确拒绝。
- transform hook后仅当输出为字符串且XML/HTML类媒体类型时声明Blob实际UTF8；原始bytes/Blob声明保留。覆盖Windows1252 XML声明序列化后重解析，不能只测内存字符串。
- Web受控imports直接指向共享包；分页/overlayer/PDF/MOBI保持原浏览器源码。

Node生产依赖固定jsdom26.1.0（MIT）及adm-zip0.6.0（MIT），由lockfile固定。adm-zip0.6.0修复旧版恶意ZIP大分配问题；当前audit仍提示文件系统extract的symlink问题，本包只读内存、从不extract/write到文件系统。浏览器门槛使用前端Playwright，未引入生产浏览器进程。

每次调整引擎/解码需重跑真实ZIP、跨宿主/渲染变换与旧CFI门槛；比较报告记录当次实际hash。
