<template>
  <div 
    v-if="show" 
    class="fixed z-[100] bg-white shadow-2xl border border-gray-100 py-2 w-48 text-sm"
    :style="{ top: y + 'px', left: x + 'px' }"
  >
    <button @click="onAction('edit')" class="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors">编辑书籍信息</button>
    <button @click="onAction('scrape')" class="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors">刮削元数据</button>
    <div class="border-t border-gray-100 my-1"></div>
    <button @click="onAction('delete')" class="w-full text-left px-4 py-2 hover:bg-gray-50 text-red-500 hover:bg-red-50 transition-colors font-bold">删除书籍</button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  show: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  action: [type: string];
  close: [];
}>();

const onAction = (type: string) => {
  emit('action', type);
  emit('close');
};

// 点击外部关闭菜单
const handleOutsideClick = () => { if (props.show) emit('close'); };
onMounted(() => window.addEventListener('click', handleOutsideClick));
onUnmounted(() => window.removeEventListener('click', handleOutsideClick));
</script>