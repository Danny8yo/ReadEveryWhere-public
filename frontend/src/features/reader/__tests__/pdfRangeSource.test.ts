import { deepStrictEqual } from 'node:assert/strict';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PDF_PREFETCH_HEAD_BYTES,
  PDF_PREFETCH_TAIL_BYTES,
  createPrefetchedRangeSource,
  type PdfRangeTransport,
} from '../../../vendor/foliate-js/pdf-range-source';

const URL_UNDER_TEST = 'https://reader.example.test/api/v1/library/books/1/file?token=signed';

/** 造一份内容可辨认的假 PDF：第 i 个字节等于 i % 251，任何一段都能验证是不是取对了位置。 */
function fakeFile(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = index % 251;
  return bytes;
}

function rangeServer(file: Uint8Array, options: { supportsRange?: boolean } = {}) {
  const requests: string[] = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const header = String((init?.headers as Record<string, string>).Range);
    requests.push(header);
    if (options.supportsRange === false) {
      return response(file, 200, null);
    }
    const suffix = /^bytes=-(\d+)$/.exec(header);
    const explicit = /^bytes=(\d+)-(\d+)$/.exec(header);
    let begin: number;
    let end: number;
    if (suffix) {
      begin = Math.max(file.length - Number(suffix[1]), 0);
      end = file.length;
    } else if (explicit) {
      begin = Number(explicit[1]);
      end = Math.min(Number(explicit[2]) + 1, file.length);
    } else {
      throw new Error(`unexpected range header: ${header}`);
    }
    const slice = file.slice(begin, end);
    return response(slice, 206, `bytes ${begin}-${end - 1}/${file.length}`);
  });
  return { fetchImpl, requests };
}

function response(body: Uint8Array, status: number, contentRange: string | null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: { get: (name: string) => (name === 'Content-Range' ? contentRange : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

/** 假的 PDFDataRangeTransport，记录 pdf.js 会收到什么。 */
function fakeTransport() {
  const delivered: { begin: number; chunk: Uint8Array }[] = [];
  const created: { length: number; initialData: Uint8Array }[] = [];
  let aborted = false;
  const transport: PdfRangeTransport = {
    requestDataRange: () => {},
    onDataRange: (begin, chunk) => { delivered.push({ begin, chunk }); },
    abort: () => { aborted = true; },
  };
  return {
    delivered,
    created,
    isAborted: () => aborted,
    createTransport: (length: number, initialData: Uint8Array) => {
      created.push({ length, initialData });
      return transport;
    },
    transport,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPrefetchedRangeSource', () => {
  let file: Uint8Array;

  beforeEach(() => {
    file = fakeFile(PDF_PREFETCH_HEAD_BYTES * 4);
  });

  it('并发预取文件头和文件尾，只用一轮往返', async () => {
    const { fetchImpl, requests } = rangeServer(file);
    const transport = fakeTransport();

    await createPrefetchedRangeSource(URL_UNDER_TEST, {
      createTransport: transport.createTransport,
      fetch: fetchImpl,
    });

    // 两个请求都不依赖对方的结果，必须是并发发出的两条，而不是先后串行的探测。
    expect(requests).toEqual([
      `bytes=0-${PDF_PREFETCH_HEAD_BYTES - 1}`,
      `bytes=-${PDF_PREFETCH_TAIL_BYTES}`,
    ]);
    expect(transport.created).toHaveLength(1);
    expect(transport.created[0].length).toBe(file.length);
    expect(transport.created[0].initialData).toEqual(file.slice(0, PDF_PREFETCH_HEAD_BYTES));
  });

  it('落在文件尾缓存里的读取不再走网络', async () => {
    const { fetchImpl, requests } = rangeServer(file);
    const transport = fakeTransport();
    await createPrefetchedRangeSource(URL_UNDER_TEST, {
      createTransport: transport.createTransport,
      fetch: fetchImpl,
    });
    const prefetchCount = requests.length;

    const begin = file.length - PDF_PREFETCH_TAIL_BYTES;
    transport.transport.requestDataRange(begin, file.length);
    await flush();

    expect(requests).toHaveLength(prefetchCount);
    expect(transport.delivered).toEqual([
      { begin, chunk: file.slice(begin, file.length) },
    ]);
  });

  it('交给 pdf.js 的是独立副本，不会连带整段缓存', async () => {
    const { fetchImpl } = rangeServer(file);
    const transport = fakeTransport();
    await createPrefetchedRangeSource(URL_UNDER_TEST, {
      createTransport: transport.createTransport,
      fetch: fetchImpl,
    });

    const begin = file.length - 1024;
    transport.transport.requestDataRange(begin, file.length);
    await flush();

    // pdf.js 会直接取走 chunk 的整个 ArrayBuffer，如果这里回递的是 subarray 视图，
    // 它拿到的会是整段 256KB 的 tail 而不是要的这 1KB。
    const { chunk } = transport.delivered[0];
    expect(chunk.byteLength).toBe(1024);
    expect(chunk.buffer.byteLength).toBe(1024);
    expect(chunk).toEqual(file.slice(begin, file.length));
  });

  it('缓存没覆盖到的位置才发请求，且只取要的那一段', async () => {
    const { fetchImpl, requests } = rangeServer(file);
    const transport = fakeTransport();
    await createPrefetchedRangeSource(URL_UNDER_TEST, {
      createTransport: transport.createTransport,
      fetch: fetchImpl,
    });
    requests.length = 0;

    const begin = PDF_PREFETCH_HEAD_BYTES * 2;
    const end = begin + 262144;
    transport.transport.requestDataRange(begin, end);
    await flush();

    // 不做窗口放大：实测多取只在少数书上省一次往返，其余书白白多传 1~2MB，净亏。
    expect(requests).toEqual([`bytes=${begin}-${end - 1}`]);
    expect(transport.delivered[0].chunk).toEqual(file.slice(begin, end));
  });

  it('请求失败时 abort，让 pdf.js 报错而不是无声挂起', async () => {
    const { fetchImpl } = rangeServer(file);
    const transport = fakeTransport();
    await createPrefetchedRangeSource(URL_UNDER_TEST, {
      createTransport: transport.createTransport,
      fetch: fetchImpl,
    });
    fetchImpl.mockRejectedValueOnce(new Error('network down'));

    transport.transport.requestDataRange(PDF_PREFETCH_HEAD_BYTES * 2, PDF_PREFETCH_HEAD_BYTES * 2 + 1024);
    await flush();

    expect(transport.isAborted()).toBe(true);
  });

  it('文件比预取的头还小时直接整份加载，不建 transport', async () => {
    const small = fakeFile(1024);
    const { fetchImpl } = rangeServer(small);
    const transport = fakeTransport();

    const source = await createPrefetchedRangeSource(URL_UNDER_TEST, {
      createTransport: transport.createTransport,
      fetch: fetchImpl,
    });

    expect(source).toEqual({ data: small });
    expect(transport.created).toHaveLength(0);
  });

  it('服务端不支持 Range 时退回整份加载', async () => {
    const { fetchImpl } = rangeServer(file, { supportsRange: false });
    const transport = fakeTransport();

    const source = await createPrefetchedRangeSource(URL_UNDER_TEST, {
      createTransport: transport.createTransport,
      fetch: fetchImpl,
    });

    // Native typed-array comparison verifies every byte without walking millions of JS properties.
    deepStrictEqual(source, { data: file });
    expect(transport.created).toHaveLength(0);
  });
});
