<template>
  <main class="login-view">
    <section class="login-view__container">
      <div class="login-view__header">
        <span class="login-view__eyebrow">Portable Reader</span>
        <h1 class="login-view__title">随身看.</h1>
        <p class="login-view__subtitle">
          {{ isRegister ? '创建您的私人数字图书馆。' : '登录以访问您的私人藏书。' }}
        </p>
      </div>

      <div class="login-view__card">
        <!-- 后端配置 (由 SearchView 转移至此) -->
        <div class="login-view__section">
          <label class="login-view__label">后端地址</label>
          <input
            v-model="backendBaseUrl"
            class="login-view__input"
            type="text"
            placeholder="localhost:3000"
          />
          <p class="login-view__hint">所有数据将存储在该服务器上。</p>
        </div>

        <div class="login-view__divider"></div>

        <!-- 登录/注册表单 -->
        <form @submit.prevent="handleSubmit" class="login-view__form">
          <div class="login-view__field">
            <label class="login-view__label">电子邮箱</label>
            <input
              v-model="form.email"
              class="login-view__input"
              type="email"
              required
              placeholder="user@example.com"
            />
          </div>

          <div class="login-view__field">
            <label class="login-view__label">密码</label>
            <input
              v-model="form.password"
              class="login-view__input"
              type="password"
              required
              placeholder="••••••••"
            />
          </div>

          <div v-if="isRegister" class="login-view__field">
            <label class="login-view__label">确认密码</label>
            <input
              v-model="form.confirmPassword"
              class="login-view__input"
              type="password"
              required
              placeholder="••••••••"
            />
          </div>

          <div v-if="error" class="login-view__error">
            {{ error }}
          </div>

          <button class="login-view__button" type="submit" :disabled="loading">
            {{ loading ? '处理中...' : (isRegister ? '注册' : '登录') }}
          </button>
        </form>

        <div v-if="registrationAvailability === 'enabled'" class="login-view__footer">
          <button @click="toggleMode" class="login-view__switch">
            {{ isRegister ? '已有账号？立即登录' : '没有账号？创建新账号' }}
          </button>
        </div>
        <p
          v-else-if="registrationAvailability === 'disabled'"
          class="login-view__registration-notice"
        >
          当前为私有测试阶段，暂不开放注册。
        </p>
        <p
          v-else-if="registrationAvailability === 'unavailable'"
          class="login-view__registration-notice login-view__registration-notice--error"
        >
          暂时无法确认注册状态，请稍后刷新。
        </p>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useRegistrationStatus } from '../features/auth/web/useRegistrationStatus';

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
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background:
    radial-gradient(circle at top left, rgba(243, 244, 246, 0.92), transparent 30%),
    linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.login-view__container {
  width: min(100%, 28rem);
}

.login-view__header {
  text-align: center;
  margin-bottom: 3rem;
}

.login-view__eyebrow {
  display: block;
  margin-bottom: 1rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.36em;
  color: #9ca3af;
  text-transform: uppercase;
}

.login-view__title {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 3.5rem;
  line-height: 1;
  letter-spacing: -0.04em;
}

.login-view__subtitle {
  margin: 1rem 0 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.login-view__card {
  background: white;
  padding: 2.5rem;
  border-radius: 1.5rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.login-view__section {
  margin-bottom: 2rem;
}

.login-view__label {
  display: block;
  margin-bottom: 0.6rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #6b7280;
  text-transform: uppercase;
}

.login-view__input {
  width: 100%;
  border: 1px solid rgba(17, 24, 39, 0.1);
  border-radius: 0.75rem;
  padding: 0.8rem 1rem;
  font-size: 0.95rem;
  transition: all 0.2s;
  outline: none;
}

.login-view__input:focus {
  border-color: #000;
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.03);
}

.login-view__hint {
  margin: 0.5rem 0 0;
  color: #9ca3af;
  font-size: 0.75rem;
}

.login-view__divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.05);
  margin-bottom: 2rem;
}

.login-view__form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.login-view__button {
  background: #000;
  color: #fff;
  border: none;
  padding: 1rem;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
  margin-top: 1rem;
}

.login-view__button:hover {
  transform: translateY(-1px);
  opacity: 0.9;
}

.login-view__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-view__error {
  color: #ef4444;
  font-size: 0.85rem;
  text-align: center;
}

.login-view__footer {
  margin-top: 2rem;
  text-align: center;
}

.login-view__switch {
  background: none;
  border: none;
  color: #6b7280;
  font-size: 0.85rem;
  cursor: pointer;
  text-decoration: underline;
}

.login-view__switch:hover {
  color: #000;
}

.login-view__registration-notice {
  margin: 2rem 0 0;
  color: #6b7280;
  font-size: 0.82rem;
  line-height: 1.5;
  text-align: center;
}

.login-view__registration-notice--error {
  color: #b45309;
}
</style>
