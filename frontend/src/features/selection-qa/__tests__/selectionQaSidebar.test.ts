// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive, nextTick } from "vue";
import SelectionQaSidebar from "../ui/SelectionQaSidebar.vue";
import QaProcessDisclosure from "../ui/QaProcessDisclosure.vue";
import { mountInBody } from "../../../__tests__/helpers/bodyView";
import {
  createQaController,
  createQaState,
} from "../domain/controller";
import type { QaApi } from "../model/selectionQa";
const identity = {
  fileChecksum: "sha256:" + "a".repeat(64),
  extractorVersion: "v5",
  normalizationVersion: "v2",
};
function setup() {
  const state = reactive(createQaState());
  state.open = true;
  const scope = { bookId: 1, ...identity, sectionIndex: 0, href: "a.xhtml" },
    artifact = {
      bookId: 1,
      artifactId: "a",
      fileChecksum: identity.fileChecksum,
    };
  state.conversation = {
    id: "conv",
    bookId: 1,
    status: "active",
    frozenReason: null,
    firstQuestion: "问题",
    createdAt: 0,
    updatedAt: 0,
    selection: {
      scope,
      artifact,
      source: {
        start: { path: [0], offset: 0 },
        end: { path: [0], offset: 2 },
      },
      start: 0,
      end: 2,
      displayedQuote: "原文",
      canonicalQuote: "原文",
    },
  };
  state.turns = [
    {
      id: "turn",
      conversationId: "conv",
      turnNumber: 1,
      question: "问题",
      answer: "可编辑的回答",
      status: "completed",
      phase: "terminal",
      citations: [],
      errorCode: null,
      lastSequence: 3,
      deadline: 0,
    },
  ];
  const api = {
    location: async () => ({
      scope,
      artifact,
      cfi: "epubcfi(/6/2!/4/2,/1:0,/1:2)",
      quote: "原文",
      quoteHash: "hash",
      locator: {},
    }),
    annotations: async () => [],
  } as unknown as QaApi;
  const controller = createQaController(state, 1, api, {
    identity: () => identity,
    commandId: () => "cmd",
    navigate: async () => {},
    changed: async () => {},
    later: () => () => {},
    savePending: () => {},
    loadPending: () => null,
  });
  return { state, qa: { state, ...controller } };
}
describe("selection QA preview accessibility", () => {
  it("focuses editable preview, traps Tab and restores the launching button", async () => {
    const h = setup();
    // 预览确认框经 UiOverlay Teleport 到 body，从 body 查询
    const wrapper = mountInBody(SelectionQaSidebar, {
      props: { qa: h.qa, bookTitle: "测试书" },
    });
    await flushPromises();
    const opener = wrapper.get('[data-testid="selection-qa-menu-turn"]');
    await opener.trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="selection-qa-preview-turn"]').trigger("click");
    await flushPromises();
    const dialog = wrapper.get('[data-testid="selection-qa-apply-dialog"]');
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="selection-qa-append-text"]').element,
    );
    const confirm = wrapper.get('[data-testid="selection-qa-apply-confirm"]');
    (confirm.element as HTMLElement).focus();
    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="selection-qa-target"]').element,
    );
    await dialog.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm.element);
    h.state.preview = null;
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(opener.element);
    wrapper.unmount();
  });
  it("keeps the receipt recovery control inside an open modal and locks uncertain edits", async () => {
    const h = setup();
    // 预览确认框经 UiOverlay Teleport 到 body，从 body 查询
    const wrapper = mountInBody(SelectionQaSidebar, {
      props: { qa: h.qa, bookTitle: "测试书" },
    });
    await wrapper.get('[data-testid="selection-qa-menu-turn"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="selection-qa-preview-turn"]')
      .trigger("click");
    await flushPromises();
    h.state.pending = {
      kind: "apply",
      turnId: "turn",
      body: {
        commandId: "same",
        appendText: "文字",
        target: {
          kind: "create",
          annotationType: "highlight",
          color: "#ffeb3b",
          cfi: "epubcfi(/6/2)",
        },
      },
    };
    await nextTick();
    const dialog = wrapper.get('[data-testid="selection-qa-apply-dialog"]');
    expect(
      dialog.find('[data-testid="selection-qa-apply-retry"]').exists(),
    ).toBe(true);
    expect(
      wrapper.findAll('[data-testid="selection-qa-apply-retry"]'),
    ).toHaveLength(1);
    expect(
      wrapper
        .get('[data-testid="selection-qa-append-text"]')
        .attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
});


it("explains usage failures without offering nonexistent answer content", async () => {
  const h = setup(); h.state.turns[0]!.status = "failed"; h.state.turns[0]!.answer = ""; h.state.turns[0]!.errorCode = "MODEL_USAGE_INVALID";
    const wrapper = mount(SelectionQaSidebar, { props: { qa: h.qa, bookTitle: "测试书" } });
  expect(wrapper.text()).toContain("用量数据不合法");
  expect(wrapper.text()).not.toContain("已生成内容仍可复制");
  h.state.turns[0]!.answer = "保留的部分回答"; await nextTick();
  expect(wrapper.text()).toContain("已生成内容仍可复制"); wrapper.unmount();
});

it("shows host-projected evidence omissions without treating them as a failed decision", async () => {
  const h = setup();
  h.state.turns[0]!.process = [{
    sequence: 1,
    at: 1,
    phase: "planning",
    detail: {
      operation: "finish_research",
      state: "completed",
      informationNeeds: [{ text: "归纳高并发手段", targetSource: "current_book", sourceName: "", evidenceIds: ["e1"] }],
      conclusion: "证据足够",
      selectedEvidenceIds: ["e1"],
      rejectedEvidenceIds: ["e2", "e3"],
      budgetOmittedEvidenceIds: ["e2", "e3"],
      externalEvidenceNeeded: [],
      insufficientEvidence: [],
    },
  }];
  const wrapper = mount(SelectionQaSidebar, { props: { qa: h.qa, bookTitle: "测试书" } });
  expect(wrapper.text()).toContain("2 个低优先级候选因本轮证据预算未选用");
  expect(wrapper.text()).not.toContain("工具失败");
  wrapper.unmount();
});

it.each([
  ['RESEARCH_BUDGET_EXHAUSTED', '资源受限', '已有结果可能不完整'],
  ['INPUT_TOKEN_LIMIT', '资源受限', '上下文过长'],
  ['NO_PROGRESS', '未完成', '连续行动未取得新信息'],
] as const)('keeps partial content and retry/apply capabilities for %s', async (errorCode, label, reason) => {
  const h = setup();
  Object.assign(h.state.turns[0]!, { status: 'failed', errorCode, answer: '已生成的部分回答' });
  const wrapper = mount(SelectionQaSidebar, { props: { qa: h.qa, bookTitle: '测试书' } });
  expect(wrapper.get('.qa-turn-heading [role="status"]').text()).toBe(label);
  expect(wrapper.text()).toContain(reason);
  expect(wrapper.text()).toContain('已生成内容仍可复制或编辑应用');
  expect(wrapper.get('[data-testid="selection-qa-turn-turn"]').attributes('data-qa-status')).toBe('failed');
  await wrapper.get('[data-testid="selection-qa-menu-turn"]').trigger('click');
  expect(wrapper.text()).toContain('重新提问（创建新轮次）');
  expect(wrapper.find('[data-testid="selection-qa-preview-turn"]').exists()).toBe(true);
  wrapper.unmount();
});

it('shows actual observations and later actions without inferring a fixed stage', () => {
  const wrapper = mount(QaProcessDisclosure, { props: { active: true, steps: [
    { sequence: 1, at: 1, phase: 'retrieving', detail: { operation: 'search_book', state: 'completed', observationStatus: 'empty', queries: ['未命中'], resultCount: 0, results: [] } },
    { sequence: 2, at: 2, phase: 'reading', detail: { operation: 'evidence_expansion', state: 'failed', observationStatus: 'recoverable_error', errorCode: 'TOOL_ARGUMENTS_INVALID' } },
    { sequence: 3, at: 3, phase: 'reading', detail: { operation: 'evidence_expansion', state: 'completed', observationStatus: 'success', results: [{ href: 'a.xhtml', start: 1, end: 10, text: '新取得的限定', sourceEvidenceId: 'e1', evidenceId: 'e2' }] } },
    { sequence: 4, at: 4, phase: 'retrieving', detail: { operation: 'search_book', state: 'not_executed', observationStatus: 'not_executed', errorCode: 'RESEARCH_BUDGET_EXHAUSTED', queries: ['新查询'] } },
    { sequence: 5, at: 5, phase: 'answer', detail: { operation: 'stream', state: 'started', modelId: 'model', evidenceCount: 1, evidenceChars: 9 } },
  ] } });
  expect(wrapper.text()).toContain('本次操作成功，但未找到结果');
  expect(wrapper.text()).toContain('参数错误已返回模型，可修正后继续');
  expect(wrapper.text()).toContain('新取得的限定');
  expect(wrapper.text()).toContain('本次操作未执行，不表示书中没有结果');
  expect(wrapper.text()).toContain('正在等待模型返回正文首段');
  expect(wrapper.text()).not.toContain('查阅已结束');
  expect(wrapper.text()).not.toContain('工具失败');
  expect(wrapper.findAll('li')).toHaveLength(5);
  wrapper.unmount();
});

it.each([
  ['interrupted', '本次操作已中断，未取得可用结果'],
  ['failed', '本次操作执行失败，本轮停止'],
] as const)('does not confuse %s observations with empty search results', (observationStatus, expected) => {
  const wrapper = mount(QaProcessDisclosure, { props: { active: false, steps: [{ sequence: 1, at: 1, phase: 'retrieving', detail: { operation: 'search_book', state: 'failed', observationStatus, errorCode: 'CONTENT_VERSION_CHANGED' } }] } });
  expect(wrapper.text()).toContain(expected);
  expect(wrapper.text()).not.toContain('未找到结果');
  wrapper.unmount();
});

it("deletes a conversation only after the in-page confirmation (no window.confirm)", async () => {
  const h = setup();
  let deleted = 0;
  const qa = { ...h.qa, delete: async () => { deleted++; } };
  const confirmSpy = vi.fn(() => true);
  vi.stubGlobal("confirm", confirmSpy);
  const wrapper = mountInBody(SelectionQaSidebar, { props: { qa, bookTitle: "测试书" } });
  const openMenu = async () => {
    await wrapper.get('[aria-label="对话操作"]').trigger("click");
    await flushPromises();
    await wrapper.findAll('[role="menuitem"]').find(item => item.text() === "删除对话")!.trigger("click");
    await flushPromises();
  };
  await openMenu();
  const dialog = () => wrapper.find('[role="dialog"][aria-label="删除整段对话？"]');
  expect(dialog().exists()).toBe(true);
  await dialog().findAll("button").find(b => b.text() === "取消")!.trigger("click");
  await flushPromises();
  expect(deleted).toBe(0);
  await openMenu();
  await dialog().findAll("button").find(b => b.text() === "删除")!.trigger("click");
  await flushPromises();
  expect(deleted).toBe(1);
  expect(confirmSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  wrapper.unmount();
});
