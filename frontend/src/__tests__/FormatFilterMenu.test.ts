// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FormatFilterMenu from '../components/FormatFilterMenu.vue';

describe('FormatFilterMenu', () => {
  it('supports multiple selected formats and clears them together', async () => {
    const wrapper = mount(FormatFilterMenu, {
      props: { modelValue: ['pdf'] },
    });

    await wrapper.get('button[aria-label="筛选书籍格式"]').trigger('click');
    const epub = wrapper.get('input[value="epub"]');
    await epub.setValue(true);
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['pdf', 'epub']]);

    await wrapper.get('button[data-testid="clear-format-filter"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);
  });
});
