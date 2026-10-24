// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInBody } from '../../../__tests__/helpers/bodyView';
import ImportBookModal from '../ui/ImportBookModal.vue';

const mocks = vi.hoisted(() => ({
  getImportCapabilities: vi.fn(),
}));

vi.mock('../api/libraryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/libraryApi')>();
  return {
    ...actual,
    getImportCapabilities: mocks.getImportCapabilities,
  };
});

// 封面流 P6：导入弹窗经 UiOverlay 渲染到 body，从 body 查询
enableAutoUnmount(afterEach);
const mountModal = () => mountInBody(ImportBookModal, {
  props: {
    isOpen: true,
    importItems: [],
  },
});

const sizedFile = (name: string, size: number) => {
  const file = new File(['book'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('ImportBookModal upload capability', () => {
  beforeEach(() => {
    mocks.getImportCapabilities.mockReset();
  });

  it('displays and enforces the backend runtime file-size limit', async () => {
    mocks.getImportCapabilities.mockResolvedValue({
      maxFileSizeBytes: 200 * 1024 * 1024,
    });
    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.text()).toContain('最大 200 MB');

    await wrapper.get('[data-testid="import-dropzone"]').trigger('drop', {
      dataTransfer: { files: [sizedFile('large.epub', 80 * 1024 * 1024)] },
    });
    expect(wrapper.text()).toContain('large.epub');

    await wrapper.get('[data-testid="import-dropzone"]').trigger('drop', {
      dataTransfer: { files: [sizedFile('too-large.epub', 201 * 1024 * 1024)] },
    });
    expect(wrapper.text()).toContain('文件大小不能超过 200 MB');
    expect(wrapper.text()).not.toContain('too-large.epub');
  });

  it('blocks file selection when the runtime capability cannot be loaded', async () => {
    mocks.getImportCapabilities.mockRejectedValue(new Error('network unavailable'));
    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.text()).toContain('无法读取上传限制，请稍后重试');
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="import-submit"]').attributes('disabled')).toBeDefined();
  });
});
