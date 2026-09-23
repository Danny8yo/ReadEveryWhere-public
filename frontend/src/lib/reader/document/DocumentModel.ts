/**
 * DocumentModel —— 文档中间层的规范化契约（阅读器无关）。
 *
 * 书籍被抽象成"章节 + 规范化纯文本 + 字符偏移基准"。标注重锚定与未来的
 * AI（书籍地图 / 阅读笔记 / 知识问答）**只依赖本模型**，永不触碰 foliate。
 *
 * 规范化文本以后端 document 模块产出为准（见 plan 3.4），前端按需拉取章节文本。
 */

/** 单个章节的元数据（不含正文，用于 TOC/结构展示）。 */
export interface DocumentSectionMeta {
  index: number;
  href: string;
  label: string;
  /** 规范化纯文本长度（字符数），用于 TextPosition 偏移基准。 */
  charCount: number;
}

/** 单个章节的完整内容（含规范化纯文本，用于重锚定与 AI）。 */
export interface DocumentSection extends DocumentSectionMeta {
  text: string;
}

/** 一本书的规范化文档模型。 */
export interface BookDocument {
  bookId: number;
  bookHash: string;
  format: string;
  sections: DocumentSectionMeta[];
}
