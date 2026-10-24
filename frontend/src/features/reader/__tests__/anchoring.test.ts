import { describe, expect, it } from 'vitest';
import { findTextPosition } from '../web/anchoring';

describe('findTextPosition', () => {
  const text = '第一段落。关键句子出现在这里。第二段落也提到关键句子结尾。';

  it('finds a unique exact match', () => {
    const pos = findTextPosition(text, { exact: '第一段落' });
    expect(pos).toEqual({ start: 0, end: 4 });
  });

  it('returns null when exact string is absent', () => {
    expect(findTextPosition(text, { exact: '不存在的文字' })).toBeNull();
  });

  it('returns null for empty exact', () => {
    expect(findTextPosition(text, { exact: '' })).toBeNull();
  });

  it('disambiguates duplicate matches using prefix/suffix context', () => {
    // "关键句子" 出现两次；用前后缀选中第二处
    const first = findTextPosition(text, { exact: '关键句子', prefix: '。', suffix: '出现' });
    const second = findTextPosition(text, { exact: '关键句子', prefix: '提到', suffix: '结尾' });
    expect(first?.start).toBe(text.indexOf('关键句子出现'));
    expect(second?.start).toBe(text.indexOf('关键句子结尾'));
    expect(first?.start).not.toBe(second?.start);
  });

  it('falls back to first occurrence when context does not match', () => {
    const pos = findTextPosition(text, { exact: '关键句子', prefix: 'zzz', suffix: 'yyy' });
    // 无上下文可分辨时返回打分最高者（此处均为 0 分 → 第一处）
    expect(pos?.start).toBe(text.indexOf('关键句子'));
  });
});
