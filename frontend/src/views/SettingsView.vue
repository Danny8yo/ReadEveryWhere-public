<template>
  <div class="max-w-6xl mx-auto px-4 md:px-8 pt-24 md:pt-28 pb-20">
    <header class="mb-12">
      <p v-if="configError" role="alert" class="text-sm text-red-600">{{ configError }}</p>
    <div class="text-[10px] font-bold uppercase tracking-[0.4em] text-gray-400 mb-2">Configuration</div>
      <h1 class="text-3xl font-light tracking-tight text-black">设置</h1>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-12">
      <aside class="border-r border-gray-100 pr-6">
        <nav class="space-y-1">
          <button
            v-for="item in settingsTabs"
            :key="item.id"
            type="button"
            @click="activeSettingsTab = item.id"
            class="w-full text-left px-3 py-3 text-xs font-bold uppercase tracking-widest transition-colors"
            :class="activeSettingsTab === item.id ? 'text-black bg-gray-50' : 'text-gray-300 hover:text-black'"
          >
            {{ item.label }}
          </button>
        </nav>
      </aside>

      <section v-if="activeSettingsTab === 'zlibrary'" class="max-w-2xl space-y-12">
        <header>
          <div class="text-[10px] font-bold uppercase tracking-[0.4em] text-gray-400 mb-2">Source</div>
          <h2 class="text-2xl font-light tracking-tight text-black">Zlibrary 配置</h2>
        </header>

        <section v-if="config" class="p-6 bg-gray-50 rounded-sm border border-gray-100">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs font-bold uppercase tracking-widest text-gray-500">当前状态</span>
            <span :class="statusClass" class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-white border">
              {{ statusText }}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div class="text-gray-400 mb-1 uppercase tracking-tighter">上游域名</div>
              <div class="font-medium">{{ config.baseUrl || '未配置' }}</div>
            </div>
            <div>
              <div class="text-gray-400 mb-1 uppercase tracking-tighter">最后登录</div>
              <div class="font-medium">{{ config.lastLoginAt || '从未' }}</div>
            </div>
            <div>
              <div class="text-gray-400 mb-1 uppercase tracking-tighter">今日下载</div>
              <div class="font-medium">{{ config.downloadsToday }} / {{ config.downloadsLimit }}</div>
            </div>
            <div>
              <div class="text-gray-400 mb-1 uppercase tracking-tighter">会员状态</div>
              <div class="font-medium">{{ config.isPremium ? 'Premium' : '免费用户' }}</div>
            </div>
          </div>
        </section>

        <form @submit.prevent="handleSave" class="space-y-8">
          <div class="space-y-6">
            <div class="group">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                上游域名 (Base URL)
              </label>
              <div class="flex gap-2 items-end">
                <input
                  v-model="form.baseUrl"
                  type="url"
                  placeholder="https://zlibrary-mirror.example.com"
                  class="flex-1 bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                  :disabled="deletingZlibraryConfig"
                  required
                />
                <button
                  type="button"
                  @click="handleSaveBaseUrl"
                  :disabled="savingUrl || saving || deletingZlibraryConfig || !form.baseUrl.trim()"
                  class="shrink-0 border border-gray-200 px-4 py-3 text-[10px] font-bold uppercase tracking-widest hover:border-black disabled:opacity-40 transition-all"
                >
                  {{ savingUrl ? '...' : '保存地址' }}
                </button>
              </div>
              <p class="mt-1 text-[10px] text-gray-400">Zlibrary 镜像站地址</p>
            </div>

            <div class="grid grid-cols-2 border border-gray-200" aria-label="Zlibrary 凭据配置方式">
              <button
                type="button"
                class="min-h-10 px-4 text-xs font-medium transition-colors"
                :class="credentialMode === 'account' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:text-black'"
                :aria-pressed="credentialMode === 'account'"
                @click="credentialMode = 'account'"
              >
                账号登录
              </button>
              <button
                type="button"
                class="min-h-10 px-4 text-xs font-medium transition-colors"
                :class="credentialMode === 'cookies' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:text-black'"
                :aria-pressed="credentialMode === 'cookies'"
                @click="credentialMode = 'cookies'"
              >
                Cookie 导入
              </button>
            </div>

            <div v-if="credentialMode === 'account'" class="group">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                Zlibrary 邮箱
              </label>
              <input
                v-model="form.email"
                type="email"
                placeholder="your-email@example.com"
                autocomplete="username"
                class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                :disabled="deletingZlibraryConfig"
                required
              />
            </div>

            <div v-if="credentialMode === 'account'" class="group">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                密码
              </label>
              <input
                v-model="form.password"
                type="password"
                placeholder="••••••••"
                autocomplete="current-password"
                class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                :disabled="deletingZlibraryConfig"
                required
              />
              <p class="mt-1 text-[10px] text-gray-400">密码仅用于本次登录验证，后端不存储</p>
            </div>

            <template v-else>
              <div class="group">
                <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                  remix_userid
                </label>
                <input
                  v-model="cookieForm.remixUserid"
                  data-testid="zlibrary-remix-userid"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                  :disabled="deletingZlibraryConfig"
                  required
                />
              </div>

              <div class="group">
                <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                  remix_userkey
                </label>
                <input
                  v-model="cookieForm.remixUserkey"
                  data-testid="zlibrary-remix-userkey"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                  :disabled="deletingZlibraryConfig"
                  required
                />
                <p class="mt-1 text-[10px] text-gray-400">凭据验证成功后加密保存，不会再次显示</p>
              </div>
            </template>
          </div>

          <div class="flex flex-wrap gap-3 pt-4">
            <button
              type="submit"
              :disabled="saving || savingUrl || deletingZlibraryConfig"
              class="flex-1 bg-black text-white px-6 py-4 text-[10px] font-bold uppercase tracking-[0.3em] hover:bg-gray-900 disabled:bg-gray-300 transition-all"
            >
              {{ saving ? '正在保存...' : credentialMode === 'account' ? '登录并保存' : '验证并保存' }}
            </button>
            <button
              v-if="config?.hasStoredConfig"
              type="button"
              :disabled="saving || savingUrl || deletingZlibraryConfig"
              class="text-red-500 px-3 py-4 text-[10px] font-bold uppercase tracking-widest disabled:opacity-40"
              @click="handleDeleteZlibraryConfig"
            >
              {{ deletingZlibraryConfig ? '删除中...' : '删除配置' }}
            </button>
          </div>
        </form>
      </section>

      <section v-else-if="activeSettingsTab === 'douban'" class="max-w-2xl space-y-12">
        <header>
          <div class="text-[10px] font-bold uppercase tracking-[0.4em] text-gray-400 mb-2">Metadata</div>
          <h2 class="text-2xl font-light tracking-tight text-black">豆瓣刮削配置</h2>
        </header>

        <form @submit.prevent class="space-y-6">
          <div class="group">
            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
              请求间隔（毫秒）
            </label>
            <input
              :value="doubanForm.requestIntervalMs"
              type="number"
              readonly
              disabled
              class="w-full bg-gray-50 border-b border-gray-200 py-3 text-sm text-gray-400 cursor-not-allowed focus:outline-none"
            />
            <p class="mt-1 text-[10px] text-gray-400">全局限速闸门，由部署者在服务器 .env(DOUBAN_REQUEST_INTERVAL_MS) 配置、所有用户共享；此处仅展示，不可在前端修改</p>
          </div>

          <!-- 豆瓣 Cookie 设置功能【后续开放】，暂时注释。恢复时：取消下方注释，
               并解除 <script> 中 savingDouban / handleSaveDouban 的注释即可。 -->
          <!--
          <div class="group">
            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
              Cookie（可选）
            </label>
            <textarea
              v-model="doubanForm.cookie"
              rows="2"
              placeholder="从浏览器复制豆瓣 Cookie 粘贴到这里"
              class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors resize-none"
            ></textarea>
            <p class="mt-1 text-[10px] text-gray-400">登录态可提高请求限额（20次/分钟 vs 10次/分钟），留空则以游客身份请求</p>
          </div>

          <div class="pt-2">
            <button
              type="submit"
              :disabled="savingDouban"
              class="w-full bg-black text-white py-4 text-[10px] font-bold uppercase tracking-[0.3em] hover:bg-gray-900 disabled:bg-gray-300 transition-all"
            >
              {{ savingDouban ? '保存中...' : '保存豆瓣配置' }}
            </button>
          </div>
          -->

          <div class="p-4 bg-gray-50 border border-dashed border-gray-200 rounded-sm">
            <div class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Coming soon</div>
            <p class="text-xs text-gray-500">豆瓣 Cookie 设置功能后续开放。当前以游客身份请求，暂不支持自定义登录态。</p>
          </div>
        </form>
      </section>

      <section v-else-if="activeSettingsTab === 'ai-reading'" class="max-w-2xl space-y-10">
        <header>
          <div class="text-[10px] font-bold uppercase tracking-[0.4em] text-gray-400 mb-2">AI Reading</div>
          <h2 class="text-2xl font-light tracking-tight text-black">DeepSeek 模型</h2>
        </header>

        <div class="border-y border-gray-100 py-5 grid grid-cols-2 gap-6 text-xs">
          <div>
            <div class="text-gray-400 mb-1 uppercase tracking-widest text-[9px]">模型</div>
            <div class="font-medium">{{ aiConfig?.displayName || 'DeepSeek-V4-flash' }}</div>
          </div>
          <div>
            <div class="text-gray-400 mb-1 uppercase tracking-widest text-[9px]">凭据</div>
            <div class="font-medium" :class="aiConfig?.hasApiKey ? 'text-green-600' : 'text-gray-500'">
              {{ aiConfig?.hasApiKey ? '已配置' : '未配置' }}
            </div>
          </div>
        </div>

        <form class="space-y-7" @submit.prevent="handleSaveAiConfig">
          <div class="group">
            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
              Model ID
            </label>
            <input
              v-model="aiForm.modelId"
              type="text"
              autocomplete="off"
              class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
            />
          </div>

          <div class="group">
            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
              API Key
            </label>
            <input
              v-model="aiForm.apiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="aiConfig?.hasApiKey ? '输入新 Key 以替换' : 'sk-...'"
              class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
            />
          </div>

          <div v-if="aiTestResult" class="border-l-2 px-3 py-2 text-xs" :class="aiTestResult.ok ? 'border-green-500 text-green-700 bg-green-50' : 'border-red-500 text-red-700 bg-red-50'">
            {{ aiTestResult.ok ? `连接成功 · ${aiTestResult.latencyMs} ms` : `连接失败 · ${aiTestResult.errorCode || 'UNKNOWN'}` }}
          </div>
          <div v-if="aiConfigError" class="text-xs text-red-600">{{ aiConfigError }}</div>

          <div class="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              class="border border-gray-200 px-5 py-3 text-[10px] font-bold uppercase tracking-widest hover:border-black disabled:opacity-40 transition-all"
              :disabled="testingAiConfig || savingAiConfig || deletingAiConfig"
              @click="handleTestAiConfig"
            >
              {{ testingAiConfig ? '测试中...' : '测试连接' }}
            </button>
            <button
              type="submit"
              class="bg-black text-white px-6 py-3 text-[10px] font-bold uppercase tracking-widest hover:bg-gray-900 disabled:bg-gray-300 transition-all"
              :disabled="savingAiConfig || testingAiConfig || deletingAiConfig"
            >
              {{ savingAiConfig ? '保存中...' : '保存配置' }}
            </button>
            <button
              v-if="aiConfig?.updatedAt != null"
              type="button"
              class="ml-auto text-red-500 px-3 py-3 text-[10px] font-bold uppercase tracking-widest disabled:opacity-40"
              :disabled="deletingAiConfig || savingAiConfig || testingAiConfig"
              @click="handleDeleteAiConfig"
            >
              {{ deletingAiConfig ? '删除中...' : '删除配置' }}
            </button>
          </div>
        </form>
      </section>

      <section v-else-if="activeSettingsTab === 'account'" class="max-w-2xl space-y-12">
        <header>
          <div class="text-[10px] font-bold uppercase tracking-[0.4em] text-gray-400 mb-2">Security</div>
          <h2 class="text-2xl font-light tracking-tight text-black">账号安全</h2>
        </header>

        <div class="p-6 bg-gray-50 rounded-sm border border-gray-100">
          <div class="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">当前账号</div>
          <div class="text-sm text-black">{{ user?.email || '未登录' }}</div>
        </div>

        <form @submit.prevent="handleResetPassword" class="space-y-8">
          <div class="space-y-6">
            <div class="group">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                当前密码
              </label>
              <input
                v-model="passwordForm.currentPassword"
                type="password"
                autocomplete="current-password"
                class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                required
              />
            </div>

            <div class="group">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                新密码
              </label>
              <input
                v-model="passwordForm.newPassword"
                type="password"
                autocomplete="new-password"
                minlength="8"
                class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                required
              />
              <p class="mt-1 text-[10px] text-gray-400">至少 8 个字符</p>
            </div>

            <div class="group">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 group-focus-within:text-black transition-colors">
                确认新密码
              </label>
              <input
                v-model="passwordForm.confirmPassword"
                type="password"
                autocomplete="new-password"
                minlength="8"
                class="w-full bg-transparent border-b border-gray-200 py-3 text-sm focus:outline-none focus:border-black transition-colors"
                required
              />
            </div>
          </div>

          <div v-if="authError" class="text-xs text-red-500">
            {{ authError }}
          </div>

          <div class="pt-4">
            <button
              type="submit"
              :disabled="authLoading"
              class="w-full bg-black text-white py-4 text-[10px] font-bold uppercase tracking-[0.3em] hover:bg-gray-900 disabled:bg-gray-300 transition-all"
            >
              {{ authLoading ? '正在重置...' : '重置密码' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useSettings } from '../features/settings/web/useSettings';
type SettingsTab = 'zlibrary' | 'douban' | 'ai-reading' | 'account';

const activeSettingsTab = ref<SettingsTab>('zlibrary');
const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'zlibrary', label: 'Zlibrary 配置' },
  { id: 'douban', label: '豆瓣配置' },
  { id: 'ai-reading', label: 'AI 阅读' },
  { id: 'account', label: '账号安全' },
];
const { user, resetPassword, loading: authLoading, error: authError } = useAuth();

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const {config,saving,savingUrl,deletingZlibraryConfig,credentialMode,form,cookieForm,doubanForm,aiConfig,aiTestResult,aiConfigError,savingAiConfig,testingAiConfig,deletingAiConfig,aiForm,configError,fetchConfig,applyZlibraryConfig,handleSaveBaseUrl,handleSave,fetchDoubanConfig,fetchAiConfig,aiPayload,handleTestAiConfig,handleSaveAiConfig,handleDeleteAiConfig:deleteAiConfig,handleDeleteZlibraryConfig:deleteZlibraryConfig}=useSettings();
const handleDeleteAiConfig=()=>{if(window.confirm('删除当前 DeepSeek 模型配置？'))void deleteAiConfig();};
const handleDeleteZlibraryConfig=()=>{if(window.confirm('删除当前 Zlibrary 配置？已入库书籍和文件不会受影响。'))void deleteZlibraryConfig();};
const statusText = computed(() => {
  if (!config.value) return '未配置';
  switch (config.value.loginStatus) {
    case 'success': return '已连接';
    case 'failed': return '登录失败';
    case 'pending': return '待配置';
    default: return '未知';
  }
});
const statusClass = computed(() => {
  if (!config.value) return 'text-gray-400 border-gray-100';
  switch (config.value.loginStatus) {
    case 'success': return 'text-green-500 border-green-100 bg-green-50/50';
    case 'failed': return 'text-red-500 border-red-100 bg-red-50/50';
    default: return 'text-yellow-500 border-yellow-100 bg-yellow-50/50';
  }
});
const handleResetPassword = async () => {
  const success = await resetPassword(
    passwordForm.value.currentPassword,
    passwordForm.value.newPassword,
    passwordForm.value.confirmPassword,
  );
  if (!success) return;

  passwordForm.value = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  };
  alert('密码已重置');
};

</script>
