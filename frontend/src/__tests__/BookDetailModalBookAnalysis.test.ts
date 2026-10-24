// @vitest-environment happy-dom
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookDetailModal from '../features/book-detail/ui/BookDetailModal.vue';
import type { SearchResultItem } from '../features/discovery/model/book';
import BookDetailContent from '../features/book-detail/ui/BookDetailContent.vue';
import { bodyView } from './helpers/bodyView';

// 详情（P5）和画像抽屉（P6）都是 UiOverlay，Teleport 到 body：挂到真实 body，从 body 查询 DOM，
// analyze 等事件从详情内容组件读取（由它发出）。断言保持不变。
enableAutoUnmount(afterEach);
function mountModal(options: Parameters<typeof mount>[1]): VueWrapper {
  const modal = mount(BookDetailModal, { ...(options as object), attachTo: document.body });
  return bodyView(modal.findComponent(BookDetailContent) as VueWrapper);
}

const baseBook: SearchResultItem = {
  id: 'library:42',
  sourceBookId: 'source-42',
  sourcePlatform: 'zlibrary',
  title: '结构化阅读',
  authors: ['测试作者'],
  publisher: '测试出版社',
  publishYear: 2026,
  identifier: 'isbn-42',
  language: 'zh-CN',
  formats: ['epub'],
  fileSize: 1024,
  fileSizeText: '1 KB',
  coverUrl: null,
  description: '一本用于测试的书。',
  downloadPath: null,
  detailUrl: null,
  readOnlineUrl: null,
  readOnlineAvailable: false,
  downloadable: true,
  availability: 'available',
  md5: null,
  sha256: null,
  zlibraryInterestScore: null,
  zlibraryQualityScore: null,
  raw: null,
};

type AnalysisSummary = {
  status: string;
  primaryGenre: string | null;
  displayLabel: string | null;
  confidence: number | null;
  analyzedAt: string | null;
  stale: boolean;
};

function withAnalysis(bookAnalysis: AnalysisSummary | null): SearchResultItem {
  return { ...baseBook, bookAnalysis } as SearchResultItem;
}

function mountDetail(bookAnalysis: AnalysisSummary | null): VueWrapper {
  return mountModal({
    props: {
      isOpen: true,
      book: withAnalysis(bookAnalysis),
      mode: 'library',
      libraryBookId: 42,
    } as never,
  });
}

function buttonByText(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
  if (!button) throw new Error(`找不到按钮：${label}`);
  return button;
}

async function openProfileDrawer(wrapper: VueWrapper) {
  await buttonByText(wrapper, '查看与编辑画像').trigger('click');
}

describe('BookDetailModal 书籍画像', () => {
  it('书架详情默认只展示画像摘要，并从入口打开编辑抽屉', async () => {
    const wrapper = mountModal({
      props: {
        isOpen: true,
        book: {
          ...baseBook,
          readingProfile: {
            id: 'profile-42',
            primaryGenre: 'technical',
            secondaryGenres: [],
            traits: ['evidence-heavy'],
            confidence: { kind: 'user-determined', score: null },
            classificationSummary: '技术阅读',
            profileVersion: 2,
            updatedAt: '2026-08-31T00:00:00.000Z',
          },
        },
        mode: 'library',
        libraryBookId: 42,
      } as never,
    });

    expect(wrapper.find('[data-testid="reading-profile-drawer"]').exists()).toBe(false);
    expect(wrapper.find('select').exists()).toBe(false);
    await buttonByText(wrapper, '查看与编辑画像').trigger('click');
    expect(wrapper.get('[data-testid="reading-profile-drawer"]').text()).toContain('技术类');
    expect(wrapper.get('[data-testid="reading-profile-drawer"]').text()).toContain('evidence-heavy');
  });

  it('书架详情直接展示已保存评分并提供重新抓取入口', () => {
    const wrapper = mountModal({
      props: {
        isOpen: true,
        book: {
          ...baseBook,
          doubanRating: {
            sourcePlatform: 'douban',
            sourceBookId: 'subject-42',
            sourceUrl: 'https://book.douban.com/subject/42/',
            title: '结构化阅读',
            authors: [],
            publisher: null,
            publishYear: null,
            isbn: null,
            rating: 8.8,
            ratingCount: 1200,
            fetchedAt: '2026-08-31T00:00:00.000Z',
          },
        },
        mode: 'library',
        libraryBookId: 42,
      } as never,
    });

    expect(wrapper.text()).toContain('8.8');
    expect(wrapper.text()).toContain('重新抓取');
    expect(wrapper.find('.detail-modal__douban-list').exists()).toBe(false);
  });

  it('未分析时提供预分析入口并发出非 force 请求意图', async () => {
    const wrapper = mountDetail(null);

    await openProfileDrawer(wrapper);
    await buttonByText(wrapper, '对此书进行 AI 预分析').trigger('click');

    expect(wrapper.emitted('analyze')).toEqual([[{ bookId: 42, force: false }]]);
  });

  it('失败时显示失败状态并允许重新提交', async () => {
    const wrapper = mountDetail({
      status: 'failed',
      primaryGenre: null,
      displayLabel: null,
      confidence: null,
      analyzedAt: null,
      stale: false,
    });

    await openProfileDrawer(wrapper);
    expect(wrapper.text()).toContain('AI 预分析失败');
    await buttonByText(wrapper, '对此书进行 AI 预分析').trigger('click');
    expect(wrapper.emitted('analyze')).toEqual([[{ bookId: 42, force: false }]]);
  });

  it('running 时显示分析中并禁用重复提交', async () => {
    const wrapper = mountDetail({
      status: 'running',
      primaryGenre: null,
      displayLabel: null,
      confidence: null,
      analyzedAt: null,
      stale: false,
    });
    await openProfileDrawer(wrapper);
    const button = buttonByText(wrapper, 'AI 预分析中');

    expect(button.attributes()).toHaveProperty('disabled');
    expect(wrapper.emitted('analyze')).toBeUndefined();
  });

  it('ready 时展示类型、置信度和分析时间', async () => {
    const wrapper = mountDetail({
      status: 'ready',
      primaryGenre: 'technical',
      displayLabel: '技术类',
      confidence: 0.92,
      analyzedAt: '2026-08-08T10:30:00.000Z',
      stale: false,
    });
    await openProfileDrawer(wrapper);

    expect(wrapper.text()).toContain('AI 预分析');
    expect(wrapper.text()).toContain('技术类');
    expect(wrapper.text()).toContain('92%');
    expect(wrapper.text()).toContain('2026');
  });

  it('ready 时重新分析发出 force=true', async () => {
    const wrapper = mountDetail({
      status: 'ready',
      primaryGenre: 'technical',
      displayLabel: '技术类',
      confidence: 0.92,
      analyzedAt: '2026-08-08T10:30:00.000Z',
      stale: false,
    });

    await openProfileDrawer(wrapper);
    await buttonByText(wrapper, '重新分析').trigger('click');

    expect(wrapper.emitted('analyze')).toEqual([[{ bookId: 42, force: true }]]);
  });

  it('已应用分析仍显示完成状态，但不再显示重复应用按钮，并将次类型显示为中文', async () => {
    const wrapper = mountModal({
      props: {
        isOpen: true,
        book: {
          ...baseBook,
          bookAnalysis: {
            status: 'ready',
            primaryGenre: 'argumentation',
            displayLabel: '论证类',
            confidence: 0.9,
            analyzedAt: '2026-08-31T00:00:00.000Z',
            stale: false,
            candidateId: null,
          },
          readingProfile: {
            id: 'profile-42',
            primaryGenre: 'argumentation',
            secondaryGenres: ['narrative'],
            traits: ['论点驱动'],
            confidence: { kind: 'ai-score', score: 0.9 },
            classificationSummary: '围绕核心论点组织材料。',
            profileVersion: 2,
            updatedAt: '2026-08-31T00:00:00.000Z',
          },
        },
        mode: 'library',
        libraryBookId: 42,
      } as never,
    });

    await openProfileDrawer(wrapper);
    expect(wrapper.text()).toContain('已完成');
    expect(wrapper.findAll('button').some((button) => button.text().includes('应用 AI 候选'))).toBe(false);
    expect(wrapper.get('input').element).toHaveProperty('value', '叙事类');
  });

  it('画像抽屉内提供独立帮助控件', async () => {
    const wrapper = mountDetail(null);

    await openProfileDrawer(wrapper);
    expect(wrapper.get('button[aria-label="AI 预分析说明"]').text()).toBe('?');
  });
});

vi.mock('../features/library/web/librarySession', () => ({ useLibraryInvalidation: () => ({invalidate: vi.fn()}), withLibraryInvalidation: (_port: unknown, command: unknown) => command }));
