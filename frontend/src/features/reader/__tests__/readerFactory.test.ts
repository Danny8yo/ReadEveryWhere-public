// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { DefaultReaderFactory } from '../web/factory';
import { FoliateReaderAdapter } from '../web/adapters/FoliateReaderAdapter';

describe('DefaultReaderFactory', () => {
  it.each(['pdf', 'epub', 'mobi', 'azw3'] as const)(
    '为 %s 创建 ReaderPort 实现',
    (format) => {
      const reader = new DefaultReaderFactory().create(format);

      expect(reader).toBeInstanceOf(FoliateReaderAdapter);
      expect(reader.isFixedLayout).toBe(false);
    },
  );
});
