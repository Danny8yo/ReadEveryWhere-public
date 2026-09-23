import type { ReaderPort } from "../domain/ReaderPort";
/** 阅读器打开来源：内存 File（EPUB 等已下载）或远程 URL（PDF 按需）。 */
export type ReaderSource =
  | {
      kind: "file";
      file: File;
      qaUnavailableReason?: string;
      epubIdentity?: import("../../selection-qa/model/selectionQa").LoadedEpubIdentity;
    }
  | {
      kind: "url";
      url: string;
    };
export interface ReaderOpenOptions {
  /** 引擎 open 前修改 book（如 PDF 设置初始 spread）。参数是引擎原始 book 对象。 */
  prepareBook?: (book: any) => void;
}
export interface WebReaderPort extends ReaderPort {
  readonly rawView?: unknown;
  open(
    source: ReaderSource,
    container: HTMLElement,
    opts?: ReaderOpenOptions,
  ): Promise<void>;
}
