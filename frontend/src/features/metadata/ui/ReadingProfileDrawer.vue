<template>
  <!-- 右侧抽屉（手机全屏）。Esc、点遮罩、关闭按钮都先经过未保存修改确认 -->
  <UiOverlay
    :open="open"
    kind="drawer"
    labelledby="profile-drawer-title"
    test-id="reading-profile-drawer"
    panel-class="profile-drawer"
    @close="requestClose"
  >
    <header class="profile-drawer__header">
      <div>
        <span>阅读画像</span>
        <h2 id="profile-drawer-title">{{ book.title }}</h2>
      </div>
      <UiButton variant="ghost" icon="close" icon-only label="关闭阅读画像" data-autofocus @click="requestClose" />
    </header>

    <div class="profile-drawer__body">
      <section class="profile-drawer__candidate" :style="{ '--drawer-accent': accent }">
        <div class="profile-drawer__section-heading">
          <span>AI 预分析</span>
          <BookAnalysisStatus :status="analysisStatus" />
        </div>
        <div v-if="hasReadyAnalysis" class="profile-drawer__analysis-result">
          <strong>{{ analysisLabel }}</strong>
          <span>{{ analysisConfidence }}</span>
          <time>{{ analysisDate }}</time>
        </div>
        <p v-else-if="analysisStatus === 'failed'">AI 预分析失败</p>
        <p v-else-if="analysisStatus === 'pending' || analysisStatus === 'running'">正在识别书籍阅读结构</p>
        <p v-else-if="analysisStatus === 'stale'">书籍内容已变化，需要重新分析</p>
        <p v-else-if="analysisStatus === 'unsupported'">当前书籍格式暂不支持 AI 预分析</p>
        <p v-else>尚未生成书籍阅读画像</p>

        <div class="profile-drawer__actions">
          <UiButton
            size="sm"
            icon="sparkle"
            :disabled="analysisActionDisabled"
            @click="emit('analyze', { bookId: libraryBookId, force: hasReadyAnalysis || analysisStatus === 'stale' })"
          >{{ analysisActionLabel }}</UiButton>
          <BookAnalysisHelp placement="bottom" />
          <UiButton
            v-if="hasReadyAnalysis && bookAnalysis?.candidateId"
            size="sm"
            variant="primary"
            @click="applyAnalysisCandidate"
          >应用 AI 候选</UiButton>
        </div>
      </section>

      <section class="profile-drawer__section">
        <div class="profile-drawer__section-heading">
          <span>当前画像</span>
          <span>{{ profileConfidenceLabel }}</span>
        </div>
        <UiField label="主类型" for-id="profile-primary-genre">
          <select id="profile-primary-genre" v-model="draft.primaryGenre" class="ui-input">
            <option :value="null">未分类</option>
            <option v-for="genre in genres" :key="genre" :value="genre">{{ genreDisplayLabel(genre) }}</option>
          </select>
        </UiField>
        <UiField label="次类型" for-id="profile-secondary-genres" hint="多个类型用逗号分隔，例如：科普, 通用">
          <input id="profile-secondary-genres" v-model="secondaryText" class="ui-input" placeholder="无" />
        </UiField>
        <UiField label="分类理由" for-id="profile-summary">
          <textarea id="profile-summary" v-model="draft.classificationSummary" class="ui-input" rows="4" maxlength="500" />
        </UiField>
        <div v-if="book.readingProfile?.traits.length" class="profile-drawer__traits">
          <span>结构特征</span>
          <p>{{ book.readingProfile.traits.join('、') }}</p>
        </div>
        <p v-if="error" class="profile-drawer__error" role="alert">{{ error }}</p>
      </section>
    </div>

    <footer class="profile-drawer__footer">
      <UiButton
        variant="ghost"
        size="sm"
        icon="trash"
        :disabled="saving || !book.readingProfile?.primaryGenre"
        @click="clear"
      >清空画像</UiButton>
      <UiButton variant="primary" :disabled="saving" @click="save">保存画像</UiButton>
    </footer>
  </UiOverlay>

  <!-- 页面内确认（替代 window.confirm），叠在抽屉之上 -->
  <UiOverlay :open="confirming !== null" kind="dialog" labelledby="profile-confirm-title" @close="settleConfirm(false)">
    <div v-if="confirming" class="profile-confirm">
      <h2 id="profile-confirm-title">{{ confirming.title }}</h2>
      <p>{{ confirming.message }}</p>
      <div class="profile-confirm__actions">
        <UiButton data-autofocus @click="settleConfirm(false)">{{ confirming.cancel }}</UiButton>
        <UiButton variant="primary" @click="settleConfirm(true)">{{ confirming.confirm }}</UiButton>
      </div>
    </div>
  </UiOverlay>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { BookDetailModel } from '../../book-detail/model/bookDetail';
import {
  BOOK_READING_GENRES,
  type BookReadingGenre,
  type FormalBookReadingProfile,
} from '../model/bookAnalysis';
import { genreDisplayLabel, isBookAnalysisReady } from '../domain/analysisState';
import { useProfileMutations } from '../web/useProfileMutations';
import BookAnalysisHelp from './BookAnalysisHelp.vue';
import BookAnalysisStatus from './BookAnalysisStatus.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import UiField from '../../../shared/ui/UiField.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';
import { bookAccent } from '../../../shared/utils/coverPalette';

const props = defineProps<{
  open: boolean;
  book: BookDetailModel;
  libraryBookId: number;
}>();
const emit = defineEmits<{
  close: [];
  analyze: [payload: { bookId: number; force: boolean }];
  profileUpdated: [profile: FormalBookReadingProfile];
}>();

const accent = computed(() => bookAccent(props.book.title));
const { saving, error, save:saveProfile, clear:clearProfile, apply:applyProfile } = useProfileMutations(() => props.libraryBookId);
const genres = BOOK_READING_GENRES;
const draft = ref<{ primaryGenre: BookReadingGenre | null; classificationSummary: string | null }>({
  primaryGenre: null,
  classificationSummary: null,
});
const secondaryText = ref('');
const baseline = ref('');
const bookAnalysis = computed(() => props.book.bookAnalysis ?? null);
const analysisStatus = computed(() => bookAnalysis.value?.status ?? 'not_analyzed');
const hasReadyAnalysis = computed(() => isBookAnalysisReady(bookAnalysis.value));
const analysisActionDisabled = computed(() => analysisStatus.value === 'pending' || analysisStatus.value === 'running');
const analysisActionLabel = computed(() => {
  if (analysisActionDisabled.value) return 'AI 预分析中';
  if (hasReadyAnalysis.value || analysisStatus.value === 'stale') return '重新分析';
  return '对此书进行 AI 预分析';
});
const analysisLabel = computed(() => bookAnalysis.value?.displayLabel
  || (bookAnalysis.value?.primaryGenre ? genreDisplayLabel(bookAnalysis.value.primaryGenre) : '未分类'));
const analysisConfidence = computed(() => typeof bookAnalysis.value?.confidence === 'number'
  ? `${Math.round(bookAnalysis.value.confidence * 100)}%`
  : '');
const analysisDate = computed(() => {
  const value = bookAnalysis.value?.analyzedAt;
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN').format(date);
});
const profileConfidenceLabel = computed(() => {
  const confidence = props.book.readingProfile?.confidence;
  if (confidence?.kind === 'user-determined') return '用户自行判定';
  if (confidence?.kind === 'ai-score' && confidence.score !== null) return `${Math.round(confidence.score * 100)}%`;
  return '未设置';
});
const serializedDraft = computed(() => JSON.stringify({
  primaryGenre: draft.value.primaryGenre,
  classificationSummary: draft.value.classificationSummary || null,
  secondaryGenres: parseSecondaryGenres(secondaryText.value),
}));
const dirty = computed(() => serializedDraft.value !== baseline.value);

const resetDraft = () => {
  const profile = props.book.readingProfile;
  draft.value = {
    primaryGenre: profile?.primaryGenre ?? null,
    classificationSummary: profile?.classificationSummary ?? null,
  };
  secondaryText.value = profile?.secondaryGenres.map(genreDisplayLabel).join(', ') ?? '';
  error.value = null;
  nextTick(() => { baseline.value = serializedDraft.value; });
};

watch(() => props.book.readingProfile, resetDraft, { immediate: true, deep: true });
// 焦点进出、Esc、背景 inert 由 UiOverlay 统一处理；这里只负责打开时重置草稿
watch(() => props.open, (open) => { if (open) resetDraft(); });

// 页面内确认框：返回用户的选择
type ConfirmRequest = { title: string; message: string; confirm: string; cancel: string; resolve: (ok: boolean) => void };
const confirming = ref<ConfirmRequest | null>(null);
function askConfirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise(resolve => { confirming.value = { ...request, resolve }; });
}
function settleConfirm(ok: boolean) {
  const request = confirming.value;
  confirming.value = null;
  request?.resolve(ok);
}

const requestClose = async () => {
  if (dirty.value && !await askConfirm({ title: '放弃未保存的修改？', message: '画像还有修改没有保存，关闭后这些修改会丢失。', confirm: '放弃修改', cancel: '继续编辑' })) return;
  emit('close');
};

const save = async () => {
  const result = await saveProfile({primaryGenre:draft.value.primaryGenre,secondaryGenres:parseSecondaryGenres(secondaryText.value),classificationSummary:draft.value.classificationSummary||null});
  if(result.ok){emit('profileUpdated',result.value);baseline.value=serializedDraft.value;}
};
const clear = async () => { const result=await clearProfile();if(result.ok)emit('profileUpdated',result.value); };
const applyAnalysisCandidate = async () => {
  const candidateId=bookAnalysis.value?.candidateId;
  if(!candidateId)return;
  const override=props.book.readingProfile?.confidence.kind==='user-determined';
  if(override&&!await askConfirm({title:'用 AI 候选覆盖？',message:'当前画像是您自行判定的，应用 AI 候选会覆盖它。',confirm:'覆盖',cancel:'保留我的判定'}))return;
  const result=await applyProfile(candidateId,override);
  if(result.ok)emit('profileUpdated',result.value);
};


function parseSecondaryGenres(value: string): BookReadingGenre[] {
  const tokens = value.split(',').map((item) => item.trim()).filter(Boolean);
  return [...new Set(tokens.map((token) => {
    const byId = genres.find((genre) => genre === token);
    if (byId) return byId;
    const byLabel = genres.find((genre) => genreDisplayLabel(genre) === token);
    if (byLabel) return byLabel;
    return token as BookReadingGenre;
  }))];
}
</script>

<style scoped>
.profile-drawer__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 20px 20px 14px; border-bottom: 1px solid var(--ui-line); }
.profile-drawer__header span { color: var(--ui-muted); font-size: 12px; }
.profile-drawer__header h2 { margin: 2px 0 0; font-size: 20px; font-weight: 900; line-height: 1.25; overflow-wrap: anywhere; }
.profile-drawer__body { display: grid; gap: 18px; padding: 18px 20px; }
.profile-drawer__candidate {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--ui-line);
  border-radius: var(--ui-radius-card);
  background: linear-gradient(160deg, color-mix(in srgb, var(--drawer-accent) 18%, var(--ui-surface)), var(--ui-surface));
}
.profile-drawer__section { display: grid; gap: 14px; }
.profile-drawer__section-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--ui-muted); font-size: 12px; }
.profile-drawer__section-heading > span:first-child { color: var(--ui-fg); font-size: 14px; font-weight: 900; }
.profile-drawer__analysis-result { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.profile-drawer__analysis-result strong { font-size: 22px; font-weight: 900; }
.profile-drawer__analysis-result span,
.profile-drawer__analysis-result time,
.profile-drawer__candidate p { margin: 0; color: var(--ui-fg2); font-size: 13px; }
.profile-drawer__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.profile-drawer__section textarea.ui-input { resize: vertical; min-height: 96px; line-height: 1.6; }
.profile-drawer__traits { padding: 10px 12px; border-radius: 12px; background: var(--ui-surface2); }
.profile-drawer__traits span { color: var(--ui-muted); font-size: 12px; }
.profile-drawer__traits p { margin: 4px 0 0; color: var(--ui-fg2); font-size: 13px; line-height: 1.6; }
.profile-drawer__error { margin: 0; color: var(--ui-err); font-size: 13px; }
.profile-drawer__footer {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 20px calc(14px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--ui-line);
  background: var(--ui-bg);
}
.profile-confirm { display: grid; gap: 10px; padding: 22px; }
.profile-confirm h2 { margin: 0; font-size: 17px; font-weight: 900; }
.profile-confirm p { margin: 0; font-size: 14px; color: var(--ui-fg2); }
.profile-confirm__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
