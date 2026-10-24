// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FormatFilterMenu from '../ui/FormatFilterMenu.vue';

describe('FormatFilterMenu', () => {
  it('supports multiple selected formats and clears them together', async () => {
    const wrapper = mount(FormatFilterMenu, {
      props: { modelValue: ['pdf'] },
    });

    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('筛选书籍格式');
    expect(wrapper.get('button[data-format="pdf"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('button[data-testid="clear-format-filter"]').attributes('aria-pressed')).toBe('false');

    await wrapper.get('button[data-format="epub"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['pdf', 'epub']]);

    await wrapper.get('button[data-testid="clear-format-filter"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);
  });

  it('再次点击已选格式会取消，顺序固定为 PDF、EPUB、MOBI、AZW3', async () => {
    const wrapper = mount(FormatFilterMenu, { props: { modelValue: ['azw3', 'pdf'] } });
    await wrapper.get('button[data-format="azw3"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['pdf']]);
    await wrapper.get('button[data-format="mobi"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['pdf', 'mobi', 'azw3']]);
  });
});
