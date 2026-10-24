<template>
  <div class="app-root">
    <div v-if="sessionStatus === 'checking'" class="app-state" role="status">
      <span class="app-state__spinner" aria-hidden="true" />
      <p>正在确认登录状态…</p>
    </div>
    <div v-else-if="sessionStatus === 'unavailable'" class="app-state" role="alert">
      <AppLogo />
      <p class="app-state__message">{{ sessionError }}</p>
      <div class="app-state__actions">
        <UiButton variant="primary" icon="refresh" @click="checkSession">重试连接</UiButton>
        <UiButton icon="cloud" @click="showLogin">配置服务器 / 登录</UiButton>
      </div>
    </div>
    <BookReader
      v-else-if="activeBook"
      :key="sessionKey"
      :file-url="activeBook.fileUrl"
      :file-name="activeBook.fileName ?? 'book.epub'"
      :book-id="activeBook.id"
      :user-id="activeBook.userId"
      :book-metadata="{ title: activeBook.title, authors: [...activeBook.authors], coverUrl: activeBook.coverUrl }"
      :mime-type="activeBook.mimeType"
      :checksum="activeBook.checksum ?? null"
      :file-size="activeBook.fileSize ?? null"
      :updated-at="activeBook.updatedAt"
      :version="activeBook.version"
      @close="closeReader"
    />
    <template v-else>
      <p v-if="error" role="alert" class="app-toast">{{ error }}</p>

      <template v-if="isAuthenticated">
        <!-- 顶栏：桌面放 logo 和账号；导航标签组单独固定（桌面在顶栏正中，手机在底部）。页面里只能有一个 <nav>，测试依赖它 -->
        <header class="app-header">
          <AppLogo />
          <div class="app-header__account">
            <span class="app-header__email" :title="user?.email">{{ user?.email }}</span>
            <span class="app-header__avatar" aria-hidden="true">{{ avatarLetter }}</span>
            <UiButton variant="ghost" size="sm" icon="logout" @click="logoutOpen = true">退出</UiButton>
          </div>
        </header>
        <nav class="app-tabs fixed" aria-label="主导航">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            type="button"
            class="app-tabs__item"
            :class="{ 'app-tabs__item--on': currentTab === tab.id }"
            :aria-current="currentTab === tab.id ? 'page' : undefined"
            @click="currentTab = tab.id"
          >
            <UiIcon :name="tab.icon" :size="18" />
            <span>{{ tab.label }}</span>
          </button>
        </nav>
      </template>

      <div :key="sessionKey" :class="{ 'app-content': isAuthenticated }">
        <template v-if="!isAuthenticated">
          <LoginView @success="handleAuthSuccess" />
        </template>
        <template v-else>
          <SearchView v-if="currentTab === 'search'" />
          <LibraryView v-if="currentTab === 'library'" />
          <SettingsView v-if="currentTab === 'settings'" />
        </template>
      </div>

      <UiOverlay :open="logoutOpen" kind="dialog" labelledby="logout-title" @close="logoutOpen = false">
        <div class="app-confirm">
          <h2 id="logout-title">退出登录？</h2>
          <p>只会退出这台设备，其他设备上的登录不受影响。</p>
          <div class="app-confirm__actions">
            <UiButton data-autofocus @click="logoutOpen = false">取消</UiButton>
            <UiButton variant="primary" @click="confirmLogout">退出登录</UiButton>
          </div>
        </div>
      </UiOverlay>
    </template>
    <UiToastHost />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { provideLibrarySession } from './features/library/web/librarySession';
import SearchView from './views/SearchView.vue';
import LibraryView from './views/LibraryView.vue';
import SettingsView from './views/SettingsView.vue';
import LoginView from './views/LoginView.vue';
import BookReader from './features/reader/ui/BookReader.vue';
import AppLogo from './shared/ui/AppLogo.vue';
import UiButton from './shared/ui/UiButton.vue';
import UiIcon, { type IconName } from './shared/ui/UiIcon.vue';
import UiOverlay from './shared/ui/UiOverlay.vue';
import UiToastHost from './shared/ui/UiToastHost.vue';
import { useAuth } from './features/auth/web/useAuth';
import { useReader } from './features/reader/web/useReader';

type Tab = 'search' | 'library' | 'settings';
const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'search', label: '采集', icon: 'compass' },
  { id: 'library', label: '书架', icon: 'book' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

const { isAuthenticated, user, sessionKey, logout, error, sessionStatus, sessionError, checkSession, showLogin } = useAuth();
const { activeBook, closeReader } = useReader();
provideLibrarySession(sessionKey, computed(() => isAuthenticated.value && sessionStatus.value === 'ready'), () => { if(!user.value)throw new Error('缺少用户');return user.value.userId; }, async () => { await checkSession();return sessionError.value===null && isAuthenticated.value && sessionStatus.value==='ready'; });
const currentTab = ref<Tab>('library'); // 默认展示书架
const logoutOpen = ref(false);
const avatarLetter = computed(() => (user.value?.email?.trim()[0] ?? '?').toUpperCase());

const handleAuthSuccess = () => {
  currentTab.value = 'library';
};

// 退出失败时 useAuth 保留会话并通过 error 显示，这里只负责关闭确认框
const confirmLogout = () => {
  logoutOpen.value = false;
  logout();
};
</script>

<style scoped>
.app-root {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--ui-bg);
  color: var(--ui-fg);
}

/* 顶栏 */
.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--ui-z-nav);
  height: calc(var(--app-header-h) + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) clamp(16px, 3vw, 32px) 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--ui-line);
}
.app-header__account {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 12px;
  color: var(--ui-muted);
}
.app-header__email {
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-header__avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  /* 品牌色，与 AppLogo 的三本书一致 */
  background: conic-gradient(#c4652b, #2d6fa8, #3c5a4a, #a9262c, #c4652b);
}

/* 导航：桌面固定在顶栏正中的胶囊 */
.app-tabs {
  top: calc(env(safe-area-inset-top, 0px) + (var(--app-header-h) - 38px) / 2);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--ui-z-nav);
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-surface);
}
.app-tabs__item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.app-tabs__item:hover { color: var(--ui-fg); }
.app-tabs__item--on { background: var(--ui-strong); color: var(--ui-on-strong); font-weight: 700; }
.app-tabs__item--on:hover { color: var(--ui-on-strong); }
.app-tabs__item:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }

/* 页面内容自成一层：页面里的 z-index 只在内容区内部比较，盖不过顶栏、底栏和 body 层的浮层（P6 起所有弹窗都已 Teleport 出去） */
.app-content {
  isolation: isolate;
  padding-top: calc(var(--app-header-h) + env(safe-area-inset-top, 0px));
}

/* 中等宽度：居中的导航会和右侧邮箱挤在一起，先收起邮箱 */
@media (max-width: 900px) {
  .app-header__email { display: none; }
}

/* 手机：顶栏只留 logo 和账号，导航变成底部标签栏 */
@media (max-width: 640px) {
  .app-tabs {
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    transform: none;
    justify-content: space-around;
    padding: 6px 10px calc(8px + env(safe-area-inset-bottom, 0px));
    border-width: 1px 0 0;
    border-radius: 0;
    background: color-mix(in srgb, var(--ui-bg2) 94%, transparent);
    backdrop-filter: blur(12px);
  }
  .app-tabs__item {
    flex-direction: column;
    gap: 2px;
    height: auto;
    min-width: 64px;
    padding: 4px 12px;
    border-radius: 10px;
    font-size: 11px;
  }
  .app-tabs__item--on, .app-tabs__item--on:hover { background: transparent; color: var(--ui-fg); }
  .app-content {
    padding-bottom: calc(var(--app-tabbar-h) + env(safe-area-inset-bottom, 0px));
  }
}

/* 会话检查中 / 连接失败 */
.app-state {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
  color: var(--ui-muted);
}
.app-state p { margin: 0; }
.app-state__message { max-width: 40ch; color: var(--ui-fg); }
.app-state__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.app-state__spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--ui-line);
  border-top-color: var(--ui-fg);
  animation: app-spin 0.8s linear infinite;
}
@keyframes app-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .app-state__spinner { animation: none; } }

/* 全局错误提示 */
.app-toast {
  position: fixed;
  left: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: var(--ui-z-toast);
  max-width: min(420px, calc(100vw - 32px));
  margin: 0;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--ui-err) 35%, transparent);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  color: var(--ui-err);
  box-shadow: 0 18px 40px -16px var(--ui-shadow);
}
@media (max-width: 640px) {
  .app-toast { bottom: calc(var(--app-tabbar-h) + 12px + env(safe-area-inset-bottom, 0px)); }
}

/* 退出确认 */
.app-confirm { display: grid; gap: 10px; padding: 22px; }
.app-confirm h2 { margin: 0; font-size: 17px; font-weight: 900; }
.app-confirm p { margin: 0; font-size: 14px; color: var(--ui-fg2); }
.app-confirm__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
