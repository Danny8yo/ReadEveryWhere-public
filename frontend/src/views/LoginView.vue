<template>
  <main class="login-view">
    <!-- 背景：斜铺的封面拼贴（登录前拿不到用户书库，用随应用打包的封面图，见 public/login-covers/CREDITS.md；纯装饰）。
         古画没有字，叠一个题签；图片加载失败时 BookCover 退回生成封面，题签随之隐藏，避免书名出现两次 -->
    <div class="login-view__mosaic" aria-hidden="true">
      <div v-for="book in MOSAIC_BOOKS" :key="book.slug" class="login-view__tile">
        <BookCover :title="book.title" :cover-url="`${COVER_BASE}${book.slug}.webp`">
          <span v-if="book.label" class="login-view__label">{{ book.title }}</span>
        </BookCover>
      </div>
    </div>

    <section class="login-view__card">
      <AppLogo class="login-view__logo" />
      <div class="login-view__header">
        <h1 class="login-view__title">{{ isRegister ? '创建账号' : '欢迎回来' }}</h1>
        <p class="login-view__subtitle">
          {{ isRegister ? '创建您的私人数字图书馆。' : '登录以访问您的私人藏书。' }}
        </p>
      </div>

      <UiField label="后端地址" for-id="login-backend" hint="所有数据将存储在该服务器上。">
        <input id="login-backend" v-model="backendBaseUrl" class="ui-input" type="text" placeholder="localhost:3000" />
      </UiField>

      <form class="login-view__form" @submit.prevent="handleSubmit">
        <UiField label="电子邮箱" for-id="login-email">
          <input id="login-email" v-model="form.email" class="ui-input" type="email" required autocomplete="email" placeholder="user@example.com" />
        </UiField>
        <UiField label="密码" for-id="login-password">
          <input id="login-password" v-model="form.password" class="ui-input" type="password" required :autocomplete="isRegister ? 'new-password' : 'current-password'" placeholder="••••••••" />
        </UiField>
        <UiField v-if="isRegister" label="确认密码" for-id="login-confirm">
          <input id="login-confirm" v-model="form.confirmPassword" class="ui-input" type="password" required autocomplete="new-password" placeholder="••••••••" />
        </UiField>
        <p v-if="error" class="login-view__error" role="alert">{{ error }}</p>
        <UiButton class="login-view__button" variant="primary" type="submit" :disabled="loading">
          {{ loading ? '处理中...' : (isRegister ? '注册' : '登录') }}
        </UiButton>
      </form>

      <div v-if="registrationAvailability === 'enabled'" class="login-view__footer">
        <button type="button" class="login-view__switch" @click="toggleMode">
          {{ isRegister ? '已有账号？立即登录' : '没有账号？创建新账号' }}
        </button>
      </div>
      <p v-else-if="registrationAvailability === 'disabled'" class="login-view__notice">
        当前为私有测试阶段，暂不开放注册。
      </p>
      <p v-else-if="registrationAvailability === 'unavailable'" class="login-view__notice login-view__notice--error">
        暂时无法确认注册状态，请稍后刷新。
      </p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useAuth } from '../features/auth/web/useAuth';
import { useRegistrationStatus } from '../features/auth/web/useRegistrationStatus';
import AppLogo from '../shared/ui/AppLogo.vue';
import BookCover from '../shared/ui/BookCover.vue';
import UiButton from '../shared/ui/UiButton.vue';
import UiField from '../shared/ui/UiField.vue';

// 登录页背景拼贴：public/login-covers/<slug>.webp，来源见同目录 CREDITS.md。
// 近年常见书的真实封面（封面上自带书名）与少量古画（label: true，叠竖排题签）交错排列
const COVER_BASE = `${import.meta.env.BASE_URL}login-covers/`;
const MOSAIC_BOOKS: Array<{ slug: string; title: string; label?: true }> = [
  { slug: 'huozhe', title: '活着' }, { slug: 'hongloumeng', title: '红楼梦', label: true }, { slug: 'santi', title: '三体' },
  { slug: 'nuowei', title: '挪威的森林' }, { slug: 'lizhi', title: '长安的荔枝' }, { slug: 'xiaowangzi', title: '小王子' },
  { slug: 'jianshi', title: '人类简史' }, { slug: 'bainian', title: '百年孤独' }, { slug: 'taohuayuan', title: '桃花源记', label: true },
  { slug: 'juwairen', title: '局外人' }, { slug: 'jieyou', title: '解忧杂货店' }, { slug: 'zhishen', title: '置身事内' },
  { slug: 'yueliang', title: '月亮与六便士' }, { slug: 'xixiangji', title: '西厢记', label: true }, { slug: 'weicheng', title: '围城' },
  { slug: 'eerguna', title: '额尔古纳河右岸' }, { slug: 'yijiubasi', title: '一九八四' }, { slug: 'sanguo', title: '三国演义', label: true },
  { slug: 'wanli', title: '万历十五年' }, { slug: 'zhigengniao', title: '杀死一只知更鸟' }, { slug: 'shishuo', title: '世说新语', label: true },
  { slug: 'ditan', title: '我与地坛' }, { slug: 'xiangtu', title: '乡土中国' }, { slug: 'zhuangzi', title: '庄子', label: true },
];

const BACKEND_BASE_URL_STORAGE_KEY = 'readEveryWhere.backendBaseUrl';
// 生产默认同源（留空）：由 Caddy 同源反代 /api，无需填后端地址；开发默认 localhost:3000。
const DEFAULT_BACKEND_BASE_URL = import.meta.env.PROD ? '' : 'localhost:3000';

const { login, register, loading, error } = useAuth();
const isRegister = ref(false);
const { registrationAvailability } = useRegistrationStatus();
const backendBaseUrl = ref(localStorage.getItem(BACKEND_BASE_URL_STORAGE_KEY) ?? DEFAULT_BACKEND_BASE_URL);

const form = reactive({
  email: '',
  password: '',
  confirmPassword: '',
});

const emit = defineEmits(['success']);

watch(backendBaseUrl, (val) => {
  localStorage.setItem(BACKEND_BASE_URL_STORAGE_KEY, val.trim() || DEFAULT_BACKEND_BASE_URL);
});



const toggleMode = () => {
  if (registrationAvailability.value !== 'enabled') return;
  isRegister.value = !isRegister.value;
  error.value = null;
};

const handleSubmit = async () => {
  let success = false;
  if (isRegister.value) {
    success = await register(form.email, form.password, form.confirmPassword);
  } else {
    success = await login(form.email, form.password);
  }

  if (success) {
    emit('success');
  }
};
</script>

<style scoped>
.login-view {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  align-items: center;
  padding: 32px clamp(16px, 6vw, 72px);
  overflow: hidden;
  background: var(--ui-bg);
  color: var(--ui-fg);
}
.login-view__mosaic {
  position: absolute;
  top: -30%;
  bottom: -30%;
  left: 34%;
  right: -25%;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  align-content: center;
  gap: 14px;
  transform: rotate(-12deg);
  pointer-events: none;
}
.login-view__tile:nth-child(odd) { transform: translateY(30%); }
.login-view__tile :deep(.book-cover) { box-shadow: 0 10px 20px -8px rgba(0, 0, 0, 0.5); }
.login-view__tile :deep(.book-cover__img) { filter: saturate(0.92); }
/* 题签：仿线装书封面左上角的竖排书名签条；只给古画加，且只在图片加载成功时显示（生成封面自带书名） */
.login-view__label {
  position: absolute;
  top: 7%;
  left: 9%;
  writing-mode: vertical-rl;
  padding: 0.7em 0.32em;
  border: 1px solid rgba(60, 40, 20, 0.35);
  outline: 2px solid rgba(250, 244, 230, 0.9);
  background: #f6efdd;
  color: #2a1d12;
  font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif;
  font-size: 10cqw;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.18em;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}
.login-view__tile:has(.book-cover__generated) .login-view__label { display: none; }
.login-view::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: var(--ui-z-raised);
  background: linear-gradient(90deg, var(--ui-bg) 0 38%, color-mix(in srgb, var(--ui-bg) 55%, transparent) 64%, color-mix(in srgb, var(--ui-bg) 10%, transparent));
  pointer-events: none;
}
.login-view__card {
  position: relative;
  z-index: var(--ui-z-raised);
  width: min(400px, 100%);
  display: grid;
  gap: 16px;
}
.login-view__logo { font-size: 18px; }
.login-view__header { display: grid; gap: 6px; }
.login-view__title { margin: 0; font-size: clamp(32px, 5vw, 44px); font-weight: 900; line-height: 1.05; letter-spacing: -0.02em; }
.login-view__subtitle { margin: 0; font-size: 15px; color: var(--ui-muted); }
.login-view__form { display: grid; gap: 14px; }
.login-view__error { margin: 0; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--ui-err) 10%, var(--ui-surface)); color: var(--ui-err); font-size: 13px; }
.login-view__button { min-height: 44px; font-size: 14px; }
.login-view__footer { text-align: center; }
.login-view__switch { border: 0; background: none; color: var(--ui-fg); font: inherit; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.login-view__switch:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; border-radius: 4px; }
.login-view__notice { margin: 0; text-align: center; font-size: 13px; color: var(--ui-muted); }
.login-view__notice--error { color: var(--ui-err); }
@media (max-width: 640px) {
  .login-view { align-items: end; padding-bottom: calc(28px + env(safe-area-inset-bottom, 0px)); }
  .login-view__mosaic { left: -20%; right: -20%; top: -12%; bottom: 58%; grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .login-view::before { background: linear-gradient(0deg, var(--ui-bg) 0 58%, color-mix(in srgb, var(--ui-bg) 30%, transparent) 80%, transparent); }
}
</style>
