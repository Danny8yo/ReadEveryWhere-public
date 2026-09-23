<template>
  <Transition name="profile-drawer">
    <div
      v-if="open"
      class="profile-drawer__backdrop"
      data-testid="reading-profile-drawer"
      @click.self="requestClose"
    >
      <aside class="profile-drawer" role="dialog" aria-modal="true" aria-labelledby="profile-drawer-title">
        <header class="profile-drawer__header">
          <div>
            <span>阅读画像</span>
            <h2 id="profile-drawer-title">{{ book.title }}</h2>
          </div>
          <button ref="closeButton" type="button" aria-label="关闭阅读画像" @click="requestClose">关闭 [x]</button>
        </header>

        <div class="profile-drawer__body">
          <section class="profile-drawer__section">
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
              <button
                type="button"
                :disabled="analysisActionDisabled"
                @click="emit('analyze', { bookId: libraryBookId, force: hasReadyAnalysis || analysisStatus === 'stale' })"
              >
                {{ analysisActionLabel }}
              </button>
              <BookAnalysisHelp />
              <button
                v-if="hasReadyAnalysis && bookAnalysis?.candidateId"
                type="button"
                @click="applyAnalysisCandidate"
              >
                应用 AI 候选
              </button>
            </div>
          </section>

          <section class="profile-drawer__section">
            <div class="profile-drawer__section-heading">
              <span>当前画像</span>
              <span>{{ profileConfidenceLabel }}</span>
            </div>
            <label>主类型
              <select v-model="draft.primaryGenre">
                <option :value="null">未分类</option>
                <option v-for="genre in genres" :key="genre" :value="genre">{{ genreDisplayLabel(genre) }}</option>
              </select>
            </label>
            <label>次类型
              <input v-model="secondaryText" placeholder="无" />
            </label>
            <label>分类理由
              <textarea v-model="draft.classificationSummary" rows="4" maxlength="500" />
            </label>
            <div v-if="book.readingProfile?.traits.length" class="profile-drawer__traits">
              <span>结构特征</span>
              <p>{{ book.readingProfile.traits.join('、') }}</p>
            </div>
            <p v-if="error" class="profile-drawer__error" role="alert">{{ error }}</p>
          </section>
        </div>

        <footer class="profile-drawer__footer">
          <button type="button" :disabled="saving" @click="save">保存画像</button>
          <button
            type="button"
            :disabled="saving || !book.readingProfile?.primaryGenre"
            @click="clear"
          >
            清空画像
          </button>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BookDetailModel } from '../../shared/model/bookDetail';
import {
  BOOK_READING_GENRES,
  type BookReadingGenre,
  type FormalBookReadingProfile,
} from '../../features/metadata/model/bookAnalysis';
import { genreDisplayLabel, isBookAnalysisReady } from '../../features/metadata/domain/analysisState';
import { useProfileMutations } from '../../features/metadata/web/useProfileMutations';
import BookAnalysisHelp from './BookAnalysisHelp.vue';
import BookAnalysisStatus from './BookAnalysisStatus.vue';

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

const closeButton = ref<HTMLButtonElement | null>(null);
const previousFocus = ref<HTMLElement | null>(null);
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
watch(() => props.open, async (open) => {
  if (!open) return;
  previousFocus.value = document.activeElement as HTMLElement | null;
  resetDraft();
  await nextTick();
  closeButton.value?.focus();
});

const requestClose = () => {
  if (dirty.value && !window.confirm('尚有未保存的画像修改，确定关闭吗？')) return;
  emit('close');
  nextTick(() => previousFocus.value?.focus());
};

const onKeydown = (event: KeyboardEvent) => {
  if (props.open && event.key === 'Escape') {
    event.preventDefault();
    requestClose();
  }
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
  if(override&&!window.confirm('当前画像由您自行判定。确定用 AI 候选覆盖吗？'))return;
  const result=await applyProfile(candidateId,override);
  if(result.ok)emit('profileUpdated',result.value);
};

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

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
.profile-drawer__backdrop { position: absolute; inset: 0; z-index: 120; background: rgb(17 24 39 / 24%); }
.profile-drawer { position: absolute; inset-block: 0; right: 0; width: min(31rem, 100%); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: #fff; box-shadow: -18px 0 50px rgb(17 24 39 / 16%); }
.profile-drawer__header { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 1px solid #e5e7eb; padding: 1.2rem 1.4rem; }
.profile-drawer__header span { color: #9ca3af; font-size: 0.65rem; font-weight: 700; }
.profile-drawer__header h2 { margin: 0.3rem 0 0; font: 1.3rem Georgia, serif; }
.profile-drawer__header button { align-self: start; font-size: 0.72rem; font-weight: 700; }
.profile-drawer__body { overflow-y: auto; padding: 0 1.4rem; }
.profile-drawer__section { padding: 1.3rem 0; border-bottom: 1px solid #e5e7eb; }
.profile-drawer__section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; color: #6b7280; font-size: 0.72rem; font-weight: 700; }
.profile-drawer__analysis-result { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem; margin-bottom: 0.8rem; }
.profile-drawer__analysis-result strong { font: 1.3rem Georgia, serif; }
.profile-drawer__analysis-result span,
.profile-drawer__analysis-result time,
.profile-drawer__section p { color: #6b7280; font-size: 0.75rem; }
.profile-drawer__section label { display: grid; gap: 0.4rem; margin-top: 0.9rem; color: #4b5563; font-size: 0.72rem; font-weight: 700; }
.profile-drawer__section input,
.profile-drawer__section select,
.profile-drawer__section textarea { width: 100%; border: 1px solid #d1d5db; background: #fff; padding: 0.65rem; color: #111827; font: 0.8rem Arial, sans-serif; }
.profile-drawer__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem; margin-top: 1rem; }
.profile-drawer__actions > button,
.profile-drawer__footer button { min-height: 2.5rem; border: 1px solid #111827; padding: 0.6rem 0.85rem; font-size: 0.72rem; font-weight: 700; }
.profile-drawer__actions > button:disabled,
.profile-drawer__footer button:disabled { border-color: #d1d5db; color: #9ca3af; }
.profile-drawer__traits { margin-top: 1rem; border-left: 2px solid #111827; padding-left: 0.75rem; }
.profile-drawer__traits span { color: #9ca3af; font-size: 0.65rem; font-weight: 700; }
.profile-drawer__traits p { margin: 0.3rem 0 0; color: #4b5563; line-height: 1.5; }
.profile-drawer__error { color: #dc2626 !important; }
.profile-drawer__footer { display: flex; gap: 0.65rem; border-top: 1px solid #e5e7eb; padding: 1rem 1.4rem; }
.profile-drawer__footer button:first-child { background: #111827; color: #fff; }
.profile-drawer-enter-active, .profile-drawer-leave-active { transition: opacity 0.2s ease; }
.profile-drawer-enter-from, .profile-drawer-leave-to { opacity: 0; }
@media (max-width: 640px) {
  .profile-drawer__backdrop { position: fixed; }
  .profile-drawer { width: 100%; }
}
</style>
