<template>
  <main class="settings">
    <div class="settings__inner">
      <header class="settings__head">
        <h1>设置</h1>
        <p v-if="configError" role="alert" class="settings__error">{{ configError }}</p>
      </header>

      <div class="settings__layout">
        <aside class="settings__side">
          <!-- 用户卡：背景是生成封面拼贴，设置页里唯一的装饰 -->
          <div class="settings__who" aria-hidden="true">
            <div class="settings__mosaic"><BookCover v-for="title in WHO_TITLES" :key="title" :title="title" /></div>
            <div class="settings__who-text">
              <b>{{ user?.email || '未登录' }}</b>
              <small>随身看账号</small>
            </div>
          </div>
          <div class="settings__tabs" role="group" aria-label="设置分类">
            <button
              v-for="item in settingsTabs"
              :key="item.id"
              type="button"
              class="settings__tab"
              :class="{ 'settings__tab--on': activeSettingsTab === item.id }"
              :aria-current="activeSettingsTab === item.id ? 'page' : undefined"
              @click="activeSettingsTab = item.id"
            >
              <UiIcon :name="item.icon" />{{ item.label }}
            </button>
          </div>
        </aside>

        <!-- Zlibrary -->
        <section v-if="activeSettingsTab === 'zlibrary'" class="settings__panel">
          <div class="settings__card">
            <div class="settings__card-head">
              <h2>Zlibrary 配置</h2>
              <UiStatus :tone="statusTone">{{ statusText }}</UiStatus>
            </div>
            <dl v-if="config" class="settings__kv">
              <div><dt>上游域名</dt><dd>{{ config.baseUrl || '未配置' }}</dd></div>
              <div><dt>最后登录</dt><dd>{{ config.lastLoginAt || '从未' }}</dd></div>
              <div><dt>今日下载</dt><dd>{{ config.downloadsToday }} / {{ config.downloadsLimit }}</dd></div>
              <div><dt>会员状态</dt><dd>{{ config.isPremium ? 'Premium' : '免费用户' }}</dd></div>
            </dl>

            <form class="settings__form" @submit.prevent="handleSave">
              <UiField label="上游域名（Base URL）" for-id="zlib-base-url" hint="Zlibrary 镜像站地址">
                <div class="settings__inline">
                  <input id="zlib-base-url" v-model="form.baseUrl" type="url" class="ui-input" placeholder="https://zlibrary-mirror.example.com" :disabled="deletingZlibraryConfig" @input="probeResult = null; probeError = null" required />
                  <UiButton type="button" :disabled="probing || saving || deletingZlibraryConfig || !form.baseUrl.trim()" @click="handleProbeBaseUrl">{{ probing ? '检测中…' : '检测连接' }}</UiButton>
                </div>
                <div class="settings__inline">
                  <UiButton type="button" :disabled="discovering || saving || deletingZlibraryConfig" @click="handleDiscoverDomains">{{ discovering ? '发现中…' : '发现候选镜像' }}</UiButton>
                  <select v-if="candidates.length" v-model="form.baseUrl" class="ui-input" aria-label="候选镜像">
                    <option v-for="candidate in candidates" :key="candidate.baseUrl" :value="candidate.baseUrl">
                      {{ candidate.baseUrl }} · {{ candidate.category }}
                    </option>
                  </select>
                </div>
                <p v-if="discoveryError" class="settings__test settings__test--err" role="alert">候选发现失败：{{ discoveryError }}</p>
                <p v-if="probeError" class="settings__test settings__test--err" role="alert">检测失败：{{ probeError }}</p>
                <p v-else-if="probeResult" class="settings__test" :class="probeResult.category === 'API_REACHABLE' ? 'settings__test--ok' : 'settings__test--err'" role="status">
                  {{ probeResult.category === 'API_REACHABLE' ? '接口可达，尚未验证账号' : `检测结果：${probeResult.category}` }}
                  <span v-if="probeResult.status"> · HTTP {{ probeResult.status }}</span>
                  · {{ new Date(probeResult.checkedAt).toLocaleString() }}
                </p>
              </UiField>

              <UiField label="凭据方式">
                <div class="settings__mode" role="group" aria-label="Zlibrary 凭据配置方式">
                  <button type="button" :aria-pressed="credentialMode === 'account'" @click="credentialMode = 'account'">账号登录</button>
                  <button type="button" :aria-pressed="credentialMode === 'cookies'" @click="credentialMode = 'cookies'">Cookie 导入</button>
                </div>
              </UiField>

              <div v-if="credentialMode === 'account'" class="ui-form-grid">
                <UiField label="Zlibrary 邮箱" for-id="zlib-email">
                  <input id="zlib-email" v-model="form.email" type="email" class="ui-input" placeholder="your-email@example.com" autocomplete="username" :disabled="deletingZlibraryConfig" required />
                </UiField>
                <UiField label="密码" for-id="zlib-password" hint="密码仅用于本次登录验证，后端不存储">
                  <input id="zlib-password" v-model="form.password" type="password" class="ui-input" placeholder="••••••••" autocomplete="current-password" :disabled="deletingZlibraryConfig" required />
                </UiField>
              </div>
              <div v-else class="ui-form-grid">
                <UiField label="remix_userid" for-id="zlib-remix-userid">
                  <input id="zlib-remix-userid" v-model="cookieForm.remixUserid" data-testid="zlibrary-remix-userid" type="password" class="ui-input" autocomplete="off" spellcheck="false" :disabled="deletingZlibraryConfig" required />
                </UiField>
                <UiField label="remix_userkey" for-id="zlib-remix-userkey" hint="凭据验证成功后加密保存，不会再次显示">
                  <input id="zlib-remix-userkey" v-model="cookieForm.remixUserkey" data-testid="zlibrary-remix-userkey" type="password" class="ui-input" autocomplete="off" spellcheck="false" :disabled="deletingZlibraryConfig" required />
                </UiField>
              </div>

              <div class="settings__actions">
                <UiButton
                  v-if="config?.hasStoredConfig"
                  variant="ghost"
                  class="settings__danger"
                  icon="trash"
                  :disabled="saving || savingUrl || deletingZlibraryConfig"
                  @click="handleDeleteZlibraryConfig"
                >{{ deletingZlibraryConfig ? '删除中...' : '删除配置' }}</UiButton>
                <UiButton type="submit" variant="primary" :disabled="saving || savingUrl || deletingZlibraryConfig">
                  {{ saving ? '正在保存...' : credentialMode === 'account' ? '登录并保存' : '验证并保存' }}
                </UiButton>
              </div>
            </form>
          </div>
        </section>

        <!-- 豆瓣 -->
        <section v-else-if="activeSettingsTab === 'douban'" class="settings__panel">
          <div class="settings__card">
            <div class="settings__card-head"><h2>豆瓣刮削配置</h2></div>
            <UiField label="请求间隔（毫秒）" for-id="douban-interval" hint="全局限速闸门，由部署者在服务器 .env(DOUBAN_REQUEST_INTERVAL_MS) 配置、所有用户共享；此处仅展示，不可在前端修改">
              <input id="douban-interval" :value="doubanForm.requestIntervalMs" type="number" class="ui-input" readonly disabled />
            </UiField>
            <!-- 豆瓣 Cookie 设置功能【后续开放】。恢复时在这里加回 Cookie 输入，并解除 <script> 中 savingDouban / handleSaveDouban 的注释。 -->
            <p class="settings__note">豆瓣 Cookie 设置功能后续开放。当前以游客身份请求，暂不支持自定义登录态。</p>
          </div>
        </section>

        <!-- AI 阅读 -->
        <section v-else-if="activeSettingsTab === 'ai-reading'" class="settings__panel">
          <div class="settings__card">
            <div class="settings__card-head">
              <h2>DeepSeek 模型</h2>
              <UiStatus :tone="aiConfig?.hasApiKey ? 'ok' : 'muted'">{{ aiConfig?.hasApiKey ? '已配置' : '未配置' }}</UiStatus>
            </div>
            <dl class="settings__kv settings__kv--two">
              <div><dt>模型</dt><dd>{{ aiConfig?.displayName || 'DeepSeek-V4-flash' }}</dd></div>
              <div><dt>凭据</dt><dd>{{ aiConfig?.hasApiKey ? '已配置' : '未配置' }}</dd></div>
            </dl>
            <form class="settings__form" @submit.prevent="handleSaveAiConfig">
              <div class="ui-form-grid">
                <UiField label="Model ID" for-id="ai-model-id">
                  <input id="ai-model-id" v-model="aiForm.modelId" type="text" class="ui-input" autocomplete="off" />
                </UiField>
                <UiField label="API Key" for-id="ai-api-key">
                  <input id="ai-api-key" v-model="aiForm.apiKey" type="password" class="ui-input" autocomplete="new-password" :placeholder="aiConfig?.hasApiKey ? '输入新 Key 以替换' : 'sk-...'" />
                </UiField>
              </div>
              <p v-if="aiTestResult" class="settings__test" :class="aiTestResult.ok ? 'settings__test--ok' : 'settings__test--err'">
                {{ aiTestResult.ok ? `连接成功 · ${aiTestResult.latencyMs} ms` : `连接失败 · ${aiTestResult.errorCode || 'UNKNOWN'}` }}
              </p>
              <p v-if="aiConfigError" class="settings__error" role="alert">{{ aiConfigError }}</p>
              <div class="settings__actions">
                <UiButton
                  v-if="aiConfig?.updatedAt != null"
                  variant="ghost"
                  class="settings__danger"
                  icon="trash"
                  :disabled="deletingAiConfig || savingAiConfig || testingAiConfig"
                  @click="handleDeleteAiConfig"
                >{{ deletingAiConfig ? '删除中...' : '删除配置' }}</UiButton>
                <UiButton :disabled="testingAiConfig || savingAiConfig || deletingAiConfig" @click="handleTestAiConfig">{{ testingAiConfig ? '测试中...' : '测试连接' }}</UiButton>
                <UiButton type="submit" variant="primary" :disabled="savingAiConfig || testingAiConfig || deletingAiConfig">{{ savingAiConfig ? '保存中...' : '保存配置' }}</UiButton>
              </div>
            </form>
          </div>
        </section>

        <!-- 外观 -->
        <section v-else-if="activeSettingsTab === 'appearance'" class="settings__panel">
          <div class="settings__card">
            <div class="settings__card-head"><h2>外观</h2></div>
            <UiField label="界面主题" hint="只影响书架、采集、设置等界面；阅读器的明亮 / 暗黑 / 羊皮主题在阅读设置里单独选择。">
              <UiSegmented :model-value="themePreference" :options="THEME_OPTIONS" label="界面主题" @update:model-value="setThemePreference" />
            </UiField>
          </div>
        </section>

        <!-- 账号安全 -->
        <section v-else-if="activeSettingsTab === 'account'" class="settings__panel">
          <div class="settings__card">
            <div class="settings__card-head"><h2>账号安全</h2></div>
            <dl class="settings__kv settings__kv--one"><div><dt>当前账号</dt><dd>{{ user?.email || '未登录' }}</dd></div></dl>
            <form class="settings__form" @submit.prevent="handleResetPassword">
              <UiField label="当前密码" for-id="account-current">
                <input id="account-current" v-model="passwordForm.currentPassword" type="password" class="ui-input" autocomplete="current-password" required />
              </UiField>
              <div class="ui-form-grid">
                <UiField label="新密码" for-id="account-new" hint="至少 8 个字符">
                  <input id="account-new" v-model="passwordForm.newPassword" type="password" class="ui-input" autocomplete="new-password" minlength="8" required />
                </UiField>
                <UiField label="确认新密码" for-id="account-confirm">
                  <input id="account-confirm" v-model="passwordForm.confirmPassword" type="password" class="ui-input" autocomplete="new-password" minlength="8" required />
                </UiField>
              </div>
              <p v-if="authError" class="settings__error" role="alert">{{ authError }}</p>
              <div class="settings__actions">
                <UiButton type="submit" variant="primary" :disabled="authLoading">{{ authLoading ? '正在重置...' : '重置密码' }}</UiButton>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>

    <!-- 删除确认（替代 window.confirm） -->
    <UiOverlay :open="pendingDelete !== null" kind="dialog" labelledby="settings-delete-title" @close="pendingDelete = null">
      <div v-if="pendingDelete" class="settings__confirm">
        <h2 id="settings-delete-title">{{ pendingDelete === 'ai' ? '删除 DeepSeek 模型配置？' : '删除 Zlibrary 配置？' }}</h2>
        <p>{{ pendingDelete === 'ai' ? '删除后选区问答需要重新配置模型才能使用。' : '已入库的书籍和文件不会受影响。' }}</p>
        <div class="settings__confirm-actions">
          <UiButton data-autofocus @click="pendingDelete = null">取消</UiButton>
          <UiButton variant="danger" icon="trash" @click="confirmDelete">删除</UiButton>
        </div>
      </div>
    </UiOverlay>
  </main>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuth } from '../features/auth/web/useAuth';
import { useSettings } from '../features/settings/web/useSettings';
import BookCover from '../shared/ui/BookCover.vue';
import UiButton from '../shared/ui/UiButton.vue';
import UiField from '../shared/ui/UiField.vue';
import UiIcon, { type IconName } from '../shared/ui/UiIcon.vue';
import UiOverlay from '../shared/ui/UiOverlay.vue';
import UiSegmented from '../shared/ui/UiSegmented.vue';
import UiStatus from '../shared/ui/UiStatus.vue';
import { showToast } from '../shared/web/toast';
import { useTheme, type ThemePreference } from '../shared/web/theme';
type SettingsTab = 'zlibrary' | 'douban' | 'ai-reading' | 'appearance' | 'account';

// 用户卡背景用的生成封面（纯装饰，不请求图片）
const WHO_TITLES = ['红楼梦', '西游记', '史记', '诗经', '论语', '庄子', '呐喊', '边城', '雷雨', '骆驼祥子', '浮生六记', '人间词话', '世说新语', '聊斋志异', '牡丹亭', '桃花扇', '镜花缘', '儒林外史'];
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];
const { preference: themePreference, setPreference: setThemePreference } = useTheme();

const activeSettingsTab = ref<SettingsTab>('zlibrary');
const settingsTabs: Array<{ id: SettingsTab; label: string; icon: IconName }> = [
  { id: 'zlibrary', label: 'Zlibrary 配置', icon: 'globe' },
  { id: 'douban', label: '豆瓣配置', icon: 'star' },
  { id: 'ai-reading', label: 'AI 阅读', icon: 'chip' },
  { id: 'appearance', label: '外观', icon: 'sparkle' },
  { id: 'account', label: '账号安全', icon: 'lock' },
];
const { user, resetPassword, loading: authLoading, error: authError } = useAuth();

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const {config,saving,savingUrl,probing,probeResult,probeError,discovering,candidates,discoveryError,deletingZlibraryConfig,credentialMode,form,cookieForm,doubanForm,aiConfig,aiTestResult,aiConfigError,savingAiConfig,testingAiConfig,deletingAiConfig,aiForm,configError,fetchConfig,applyZlibraryConfig,handleSaveBaseUrl,handleProbeBaseUrl,handleDiscoverDomains,handleSave,fetchDoubanConfig,fetchAiConfig,aiPayload,handleTestAiConfig,handleSaveAiConfig,handleDeleteAiConfig:deleteAiConfig,handleDeleteZlibraryConfig:deleteZlibraryConfig}=useSettings();
// 删除走页面内确认框（替代 window.confirm）
const pendingDelete=ref<'ai'|'zlibrary'|null>(null);
const handleDeleteAiConfig=()=>{pendingDelete.value='ai';};
const handleDeleteZlibraryConfig=()=>{pendingDelete.value='zlibrary';};
const confirmDelete=()=>{const target=pendingDelete.value;pendingDelete.value=null;if(target==='ai')void deleteAiConfig();else if(target==='zlibrary')void deleteZlibraryConfig();};
const statusText = computed(() => {
  if (!config.value) return '未配置';
  switch (config.value.loginStatus) {
    case 'success': return '已连接';
    case 'failed': return '登录失败';
    case 'pending': return '待配置';
    default: return '未知';
  }
});
const statusTone = computed<'ok' | 'err' | 'warn' | 'muted'>(() => {
  if (!config.value) return 'muted';
  switch (config.value.loginStatus) {
    case 'success': return 'ok';
    case 'failed': return 'err';
    default: return 'warn';
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
  showToast('密码已重置', 'ok');
};

</script>

<style scoped>
.settings { min-height: 100vh; padding: 28px clamp(16px, 3vw, 32px) 48px; background: var(--ui-bg); color: var(--ui-fg); }
.settings__inner { max-width: 1040px; margin: 0 auto; }
.settings__head { display: grid; gap: 8px; margin-bottom: 20px; }
.settings__head h1 { margin: 0; font-size: 26px; font-weight: 900; }
.settings__error { margin: 0; color: var(--ui-err); font-size: 13px; }
.settings__layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 26px; align-items: start; }
.settings__side { display: grid; gap: 10px; position: sticky; top: calc(var(--app-header-h) + 20px); }
.settings__who { position: relative; overflow: hidden; border-radius: var(--ui-radius-card); padding: 14px; color: #fff; background: #111; }
.settings__mosaic { position: absolute; inset: -10px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; opacity: 0.6; transform: rotate(-8deg) scale(1.2); }
.settings__mosaic :deep(.book-cover) { border-radius: 2px; }
.settings__who::after { content: ""; position: absolute; inset: 0; background: linear-gradient(0deg, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.2)); }
.settings__who-text { position: relative; z-index: var(--ui-z-raised); display: grid; gap: 2px; padding-top: 40px; }
.settings__who-text b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings__who-text small { font-size: 12px; opacity: 0.75; }
.settings__tabs { display: grid; gap: 4px; }
.settings__tab { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-muted); font: inherit; font-size: 14px; text-align: left; cursor: pointer; white-space: nowrap; }
.settings__tab:hover { color: var(--ui-fg); }
.settings__tab--on { background: var(--ui-surface); color: var(--ui-fg); font-weight: 700; box-shadow: 0 1px 0 var(--ui-line); }
.settings__tab:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: -2px; }
.settings__panel { min-width: 0; }
.settings__card { display: grid; gap: 16px; padding: 20px; border: 1px solid var(--ui-line); border-radius: 18px; background: var(--ui-surface); }
.settings__card-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; }
.settings__card-head h2 { margin: 0; font-size: 17px; font-weight: 900; }
.settings__kv { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin: 0; overflow: hidden; border-radius: 12px; background: var(--ui-line); }
.settings__kv--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.settings__kv--one { grid-template-columns: 1fr; }
.settings__kv div { display: grid; gap: 2px; min-width: 0; padding: 10px 12px; background: var(--ui-surface2); }
.settings__kv dt { font-size: 11px; color: var(--ui-muted); }
.settings__kv dd { margin: 0; font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings__form { display: grid; gap: 14px; }
.settings__inline { display: flex; gap: 8px; }
.settings__inline .ui-input { flex: 1; min-width: 0; }
.settings__mode { display: inline-flex; justify-self: start; gap: 2px; padding: 3px; border: 1px solid var(--ui-line); border-radius: 999px; background: var(--ui-surface2); }
.settings__mode button { padding: 5px 14px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-muted); font: inherit; font-size: 13px; cursor: pointer; }
.settings__mode button[aria-pressed="true"] { background: var(--ui-strong); color: var(--ui-on-strong); font-weight: 700; }
.settings__mode button:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 1px; }
.settings__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.settings__danger { color: var(--ui-err); margin-right: auto; }
.settings__note { margin: 0; padding: 12px 14px; border: 1px dashed var(--ui-line); border-radius: 12px; font-size: 13px; color: var(--ui-muted); }
.settings__test { margin: 0; padding: 8px 12px; border-radius: 10px; font-size: 13px; }
.settings__test--ok { background: color-mix(in srgb, var(--ui-ok) 12%, transparent); color: var(--ui-ok); }
.settings__test--err { background: color-mix(in srgb, var(--ui-err) 12%, transparent); color: var(--ui-err); }
.settings__confirm { display: grid; gap: 10px; padding: 22px; }
.settings__confirm h2 { margin: 0; font-size: 17px; font-weight: 900; }
.settings__confirm p { margin: 0; font-size: 14px; color: var(--ui-fg2); }
.settings__confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
@media (max-width: 760px) {
  .settings__layout { grid-template-columns: 1fr; }
  .settings__side { position: static; }
  .settings__who { display: none; }
  .settings__tabs { grid-auto-flow: column; grid-auto-columns: max-content; overflow-x: auto; scrollbar-width: none; }
  .settings__kv { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settings__card { padding: 16px; }
}
</style>
