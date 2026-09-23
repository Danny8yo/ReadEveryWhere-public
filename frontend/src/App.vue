 <template>
  <div class="min-h-screen bg-white">
    <div v-if="sessionStatus === 'checking'" class="p-12 text-center" role="status">正在确认登录状态…</div>
    <div v-else-if="sessionStatus === 'unavailable'" class="p-12 text-center" role="alert">
      <p>{{ sessionError }}</p>
      <button class="m-4 underline" @click="checkSession">重试连接</button>
      <button class="m-4 underline" @click="showLogin">配置服务器 / 登录</button>
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
      <p v-if="error" role="alert" class="fixed bottom-4 left-4 z-[100] bg-white p-4 text-red-600">{{ error }}</p>
      <!-- 极简固定导航 -->
      <nav v-if="isAuthenticated" class="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-50">
        <div class="max-w-7xl mx-auto px-4 md:px-8 py-4 md:py-6 flex justify-between items-center gap-3">
          <div class="flex min-w-0 items-center gap-4">
            <span class="text-xs font-bold uppercase tracking-[0.3em]">随身看</span>
            <span class="hidden md:inline text-[10px] text-gray-400">| {{ user?.email }}</span>
          </div>
          <div class="flex shrink-0 gap-4 md:gap-8 text-xs font-bold uppercase tracking-widest">
            <button @click="currentTab = 'search'" :class="currentTab === 'search' ? 'text-black' : 'text-gray-300'">采集</button>
            <button @click="currentTab = 'library'" :class="currentTab === 'library' ? 'text-black' : 'text-gray-300'">书架</button>
            <button @click="currentTab = 'settings'" :class="currentTab === 'settings' ? 'text-black' : 'text-gray-300'">设置</button>
            <button @click="handleLogout" class="text-gray-300 hover:text-red-400 transition-colors">退出</button>
          </div>
        </div>
      </nav>

      <!-- 动态组件 -->
      <div :key="sessionKey" :class="isAuthenticated ? 'pt-10' : ''">
        <template v-if="!isAuthenticated">
          <LoginView @success="handleAuthSuccess" />
        </template>
        <template v-else>
          <SearchView v-if="currentTab === 'search'" />
          <LibraryView v-if="currentTab === 'library'" />
          <SettingsView v-if="currentTab === 'settings'" />
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { provideLibrarySession } from './features/library/web/librarySession';
import SearchView from './views/SearchView.vue';
import LibraryView from './views/LibraryView.vue';
import SettingsView from './views/SettingsView.vue';
import LoginView from './views/LoginView.vue';
import BookReader from './components/BookReader.vue';
import { useAuth } from './composables/useAuth';
import { useReader } from './composables/useReader';

const { isAuthenticated, user, sessionKey, logout, error, sessionStatus, sessionError, checkSession, showLogin } = useAuth();
const { activeBook, closeReader } = useReader();
provideLibrarySession(sessionKey, computed(() => isAuthenticated.value && sessionStatus.value === 'ready'), () => { if(!user.value)throw new Error('缺少用户');return user.value.userId; }, async () => { await checkSession();return sessionError.value===null && isAuthenticated.value && sessionStatus.value==='ready'; });
const currentTab = ref('library'); // 默认展示书架

const handleAuthSuccess = () => {
  currentTab.value = 'library';
};

const handleLogout = () => {
  if (confirm('确定要退出登录吗？')) {
    logout();
  }
};

</script>

<style>
/* 保持你原本的样式，这里不需要改动 */
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body, #app { min-height: 100%; margin: 0; }
/* 滚动条极简美化 */
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #000; }
</style>
