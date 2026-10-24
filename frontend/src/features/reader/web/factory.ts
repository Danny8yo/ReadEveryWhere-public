import type { BookFormat } from '../../../shared/utils/bookFormat';
import { FoliateReaderAdapter } from './adapters/FoliateReaderAdapter';
import type { WebReaderPort as ReaderPort } from './WebReaderPort';


/** 阅读器实现的装配边界；消费层只依赖 ReaderPort。 */
export interface ReaderFactory {
  create(format: BookFormat): ReaderPort;
}

/**
 * 当前支持的格式都由 foliate-js 承载。
 * 将来引入其他引擎时，只在这里按格式/能力替换实现，BookReader 无需感知。
 */
export class DefaultReaderFactory implements ReaderFactory {
  create(format: BookFormat): ReaderPort {
    switch (format) {
      case 'pdf':
      case 'epub':
      case 'mobi':
      case 'azw3':
        return new FoliateReaderAdapter();
      default: {
        const exhaustiveFormat: never = format;
        throw new Error(`Unsupported book format: ${String(exhaustiveFormat)}`);
      }
    }
  }
}

/** 应用默认组合根使用的工厂实例。 */
export const readerFactory: ReaderFactory = new DefaultReaderFactory();
