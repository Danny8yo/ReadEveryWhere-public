// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive, nextTick } from "vue";
import SelectionQaSidebar from "../components/selection-qa/SelectionQaSidebar.vue";
import {
  createQaController,
  createQaState,
} from "../features/selection-qa/domain/controller";
import type { QaApi } from "../features/selection-qa/model/selectionQa";
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
    const wrapper = mount(SelectionQaSidebar, {
      props: { qa: h.qa, bookTitle: "测试书" },
      attachTo: document.body,
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
    const wrapper = mount(SelectionQaSidebar, {
      props: { qa: h.qa, bookTitle: "测试书" },
      attachTo: document.body,
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
