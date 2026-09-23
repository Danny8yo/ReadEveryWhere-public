<template>
  <section class="conversation-composer" aria-label="连续追问">
    <div v-if="frozen" class="composer-notice frozen" role="status">
      书籍内容版本已变化，此会话仅供查阅。
    </div>
    <div v-else-if="needsInput" class="composer-notice" role="status">
      {{ clarificationQuestion || 'Agent 需要你补充信息后才能继续。' }}
    </div>

    <label class="composer-label" :for="inputId">
      {{ isFirstTurn ? '阅读目标' : needsInput ? '补充说明' : '继续追问' }}
    </label>
    <textarea
      :id="inputId"
      v-model="message"
      class="composer-input"
      rows="3"
      maxlength="4000"
      :placeholder="isFirstTurn ? '例如：梳理作者对技术进步与社会变迁关系的核心论证' : '解释上一条、换个角度、继续读这一章或引用依据'"
      :disabled="disabled || active || frozen"
      @keydown.meta.enter.prevent="submit"
      @keydown.ctrl.enter.prevent="submit"
    />
    <div v-if="readerFocus" class="reader-focus">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
      <span>{{ readerFocus.chapterLabel || `章节 ${readerFocus.sectionIndex + 1}` }}</span>
    </div>

    <details v-if="budgetConfig && budget" ref="budgetDetails" class="composer-budget">
      <summary ref="budgetSummary">本轮预算 · {{ budgetLabel }}</summary>
      <div class="composer-budget-toolbar">
        <span>调整档位</span>
        <button
          class="composer-budget-close"
          type="button"
          aria-label="关闭预算设置"
          title="关闭预算设置"
          @click="closeBudget"
        >
          &times;
        </button>
      </div>
      <AiReadingBudgetEditor v-model="budget" :config="budgetConfig" :disabled="disabled || active || frozen" />
    </details>

    <div class="composer-actions">
      <button v-if="active" class="composer-button danger" type="button" :disabled="mutating" @click="emit('cancel')">
        停止
      </button>
      <button v-else-if="frozen" class="composer-button primary" type="button" @click="emit('new-conversation')">
        基于当前版本新建会话
      </button>
      <button
        v-else
        class="composer-button primary"
        type="button"
        :disabled="disabled || budgetValid === false || !message.trim() || !budget"
        @click="submit"
      >
        {{ creating ? '正在提交...' : isFirstTurn ? '开始阅读' : '发送' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  ReadingBudgetConfig,
  ReadingBudgetSelection,
  ReadingReaderFocus,
} from '../../features/ai-reading/model/aiReading';
import AiReadingBudgetEditor from './AiReadingBudgetEditor.vue';

const props = defineProps<{
  budgetConfig: ReadingBudgetConfig | null;
  readerFocus?: ReadingReaderFocus;
  isFirstTurn?: boolean;
  active?: boolean;
  frozen?: boolean;
  needsInput?: boolean;
  clarificationQuestion?: string | null;
  disabled?: boolean;
  budgetValid?: boolean;
  creating?: boolean;
  mutating?: boolean;
}>();

const message = defineModel<string>('message', { required: true });
const budget = defineModel<ReadingBudgetSelection | null>('budget', { required: true });
const emit = defineEmits<{ submit: []; cancel: []; 'new-conversation': [] }>();
const budgetDetails = ref<HTMLDetailsElement | null>(null);
const budgetSummary = ref<HTMLElement | null>(null);

const budgetLabel = computed(() => {
  if (!budget.value) return '未选择';
  if (budget.value.budgetMode === 'custom') return '自定义';
  return ({ quick: '快速', standard: '标准', deep: '深入' })[budget.value.budgetTier];
});
const inputId = computed(() => props.isFirstTurn ? 'ai-reading-goal' : 'reading-conversation-message');

function submit() {
  if (!message.value.trim() || !budget.value) return;
  emit('submit');
}

function closeBudget() {
  if (!budgetDetails.value) return;
  budgetDetails.value.open = false;
  budgetSummary.value?.focus();
}
</script>

<style scoped>
.conversation-composer { padding: 14px 16px 16px; border-top: 1px solid var(--rd-divider); background: var(--rd-panel-bg); }
.composer-label { color: var(--rd-muted); font-size: 10px; font-weight: 800; }
.composer-input { width: 100%; min-height: 76px; max-height: 180px; resize: vertical; margin-top: 7px; padding: 10px 11px; border: 1px solid var(--rd-border); border-radius: 6px; background: var(--rd-chip-bg); color: var(--rd-fg); font-size: 12px; line-height: 1.55; outline: none; }
.composer-input:focus { border-color: var(--rd-accent); }.composer-input:disabled { opacity: .6; }
.composer-notice { margin-bottom: 10px; padding: 8px 10px; border-left: 3px solid #d97706; background: rgba(217,119,6,.08); color: var(--rd-fg); font-size: 10px; line-height: 1.5; }
.composer-notice.frozen { border-left-color: var(--rd-muted); }
.reader-focus { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 6px; color: var(--rd-muted); font-size: 9px; }
.reader-focus span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-budget { margin-top: 8px; }.composer-budget > summary { cursor: pointer; color: var(--rd-muted-strong); font-size: 9px; }
.composer-budget > summary:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
.composer-budget-toolbar { display: flex; align-items: center; justify-content: space-between; min-height: 30px; margin-top: 7px; color: var(--rd-muted-strong); font-size: 10px; font-weight: 700; }
.composer-budget-close { display: inline-grid; width: 28px; height: 28px; place-items: center; border-radius: 4px; color: var(--rd-muted); font-size: 20px; line-height: 1; }
.composer-budget-close:hover { color: var(--rd-fg); background: var(--rd-chip-bg); }
.composer-budget-close:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
.composer-actions { display: flex; justify-content: flex-end; margin-top: 10px; }
.composer-button { min-height: 34px; padding: 8px 14px; border-radius: 6px; font-size: 11px; font-weight: 750; }
.composer-button.primary { color: var(--rd-accent-fg); background: var(--rd-accent); }.composer-button.danger { color: #fff; background: #dc2626; }
.composer-button:disabled { opacity: .45; cursor: not-allowed; }
</style>
