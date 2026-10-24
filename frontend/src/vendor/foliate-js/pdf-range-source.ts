/**
 * pdf.js 打开远端 PDF 时的数据源：开书前并发预取文件头和文件尾。
 *
 * 为什么需要它：打开一本 PDF，pdf.js 要在文件里跳 5~6 个位置取数据，而每个位置只有解析完
 * 上一处才知道——文件尾 → startxref → xref 表 → 文档目录 → 页树 → 页对象 → 内容流。这是一条
 * 串行的指针链，远端 RTT 300~400ms 时光等往返就三四秒。调大 rangeChunkSize 没用：这些位置
 * 横跨整个文件（实测一本 62MB 的书落在 0.0M / 62.8M / 15.5M / 0.3M / 0.5M / 16.0M），合并不了，
 * 块开大只会让每次多传几倍无用字节。
 *
 * 但链条起点的两处是「不用解析就知道要读」的：文件开头，和文件末尾的 xref。开书前把这两段
 * 并发取回，pdf.js 的前几次读取直接命中内存，实测串行往返从 6 次降到 1~4 次。
 *
 * 两个常量都是实测出来的：
 * - 头部 1MB 是平衡点。取 2MB / 4MB 并不能少几次往返，多出来的传输时间反而超过省下的延迟。
 * - 未命中时按 pdf.js 要的大小原样取，不做放大。试过未命中时多取 1MB 让邻近读取蹭缓存，
 *   6 本测试书里只有 2 本少了一次往返，其余 4 本白白多传 1~2MB，净亏。
 */

export const PDF_PREFETCH_HEAD_BYTES = 1024 * 1024;
export const PDF_PREFETCH_TAIL_BYTES = 256 * 1024;

/** pdf.js 的 PDFDataRangeTransport 中本模块用到的部分。 */
export interface PdfRangeTransport {
  requestDataRange: (begin: number, end: number) => void;
  onDataRange: (begin: number, chunk: Uint8Array) => void;
  abort: () => void;
}

export interface PdfRangeSourceDeps {
  createTransport: (length: number, initialData: Uint8Array) => PdfRangeTransport;
  fetch?: typeof globalThis.fetch;
}

/** 交给 pdf.js 的 getDocument：要么整份数据，要么一个按需取块的 transport。 */
export type PdfRangeSource = { data: Uint8Array } | { range: PdfRangeTransport };

/** 只在显式选择 full 模式时使用：把远程 PDF 完整读入内存后交给 pdf.js。 */
interface RangeResponse {
  data: Uint8Array;
  totalSize: number | null;
  isPartial: boolean;
}

async function requestRange(
  url: string,
  rangeHeader: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<RangeResponse> {
  const response = await fetchImpl(url, { headers: { Range: rangeHeader } });
  if (!response.ok) {
    throw new Error(`PDF range request failed: ${response.status} ${response.statusText}`);
  }
  // 只有 206 才带 Content-Range；服务端忽略 Range 直接回 200 时拿不到总长度。
  const contentRange = response.headers.get("Content-Range");
  const totalSize = contentRange ? Number(contentRange.split("/").at(-1)) : null;
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    totalSize: totalSize !== null && Number.isFinite(totalSize) ? totalSize : null,
    isPartial: response.status === 206,
  };
}

export async function createPrefetchedRangeSource(
  url: string,
  deps: PdfRangeSourceDeps,
): Promise<PdfRangeSource> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const [head, tail] = await Promise.all([
    requestRange(url, `bytes=0-${PDF_PREFETCH_HEAD_BYTES - 1}`, fetchImpl),
    requestRange(url, `bytes=-${PDF_PREFETCH_TAIL_BYTES}`, fetchImpl),
  ]);

  // 服务端不支持 Range（回 200）时 head 就是整份文件，直接整份交给 pdf.js。
  if (!head.isPartial || head.totalSize === null) return { data: head.data };
  const size = head.totalSize;
  // 文件比预取的头还小：head 已经是全部内容，同样不需要 transport。
  if (head.data.length >= size) return { data: head.data };

  // head 作为 initialData 交给 pdf.js，落在这一段里的读取它根本不会来问；
  // tail 只能自己缓存着，等 pdf.js 要。
  const tailBegin = size - tail.data.length;
  const transport = deps.createTransport(size, head.data);

  transport.requestDataRange = (begin: number, end: number): void => {
    const boundedEnd = Math.min(end, size);
    if (tailBegin <= begin && boundedEnd <= size && tail.data.length > 0) {
      // 必须切出独立副本：pdf.js 会取走整个 ArrayBuffer，直接给 subarray 会把整段 tail
      // 当成这一次的返回内容。
      const chunk = tail.data.slice(begin - tailBegin, boundedEnd - tailBegin);
      // 异步回递：onDataRange 要求对应的 reader 已经挂好，同步回调依赖 pdf.js 的内部顺序。
      queueMicrotask(() => transport.onDataRange(begin, chunk));
      return;
    }
    void requestRange(url, `bytes=${begin}-${boundedEnd - 1}`, fetchImpl)
      .then(({ data }) => transport.onDataRange(begin, data))
      // transport 没有错误通道，abort 让 pdf.js 以「流中断」失败，而不是无声挂起。
      .catch(() => transport.abort());
  };

  return { range: transport };
}
