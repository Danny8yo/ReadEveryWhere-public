// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AnnotationNoteModal from '../components/AnnotationNoteModal.vue';
import { Overlayer } from '../lib/foliate-js/overlayer.js';
describe('full annotation notes', () => {
  it('opens existing Markdown for reading and preserves drafts while previewing and switching notes', async () => {
    const note = '**开头**\n\n' + '长笔记正文。\n\n'.repeat(80) + '最后一段';
    const w = mount(AnnotationNoteModal, { props: { visible: true, selectedText: '原文', initialNote: note, activeId: 'a', annotationOptions: [{ id: 'a', label: '旧笔记' }, { id: 'b', label: '新笔记' }] }, global: { stubs: { teleport: true } } });
    expect(w.get('[aria-label="笔记全文"]').text()).toContain('最后一段');
    expect(w.get('strong').text()).toBe('开头');
    expect(w.find('textarea').exists()).toBe(false);
    await w.get('.note-tabs button:nth-child(2)').trigger('click');
    await w.get('textarea').setValue('**改过的笔记**');
    expect(w.get('select').attributes('disabled')).toBeDefined();
    await w.get('.note-tabs button:first-child').trigger('click');
    expect(w.get('strong').text()).toBe('改过的笔记');
    await w.get('.note-footer button:first-child').trigger('click');
    expect(w.get('select').attributes('disabled')).toBeUndefined();
    await w.get('select').setValue('b');
    expect(w.emitted('select-annotation')).toEqual([['b']]);
    await w.setProps({ activeId: 'b', initialNote: '第二条' });
    expect(w.get('[aria-label="笔记全文"]').text()).toBe('第二条');
    w.unmount();
  });
  it('reports every overlapping marker once and keeps remaining markers after deletion', () => {
    const layer = new Overlayer();
    const rect = { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
    const range = { getClientRects: () => [rect, rect] };
    layer.add('first', range, Overlayer.highlight, {});
    layer.add('second', range, Overlayer.highlight, {});
    expect(layer.hitTestAll({ x: 20, y: 10 }).map((x: unknown[]) => x[0])).toEqual(['second', 'first']);
    layer.remove('second');
    expect(layer.hitTest({ x: 20, y: 10 })[0]).toBe('first');
  });
});
