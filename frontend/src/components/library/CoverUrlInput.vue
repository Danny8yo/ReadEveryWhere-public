<template>
  <div class="space-y-3">
    <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">封面</label>
    <div class="flex gap-4 items-start">
      <div class="w-32 aspect-[3/4] bg-gray-50 rounded-sm overflow-hidden flex-shrink-0 shadow-sm relative">
        <img
          v-if="modelValue"
          :key="modelValue"
          :src="modelValue"
          class="w-full h-full object-cover"
          @error="coverLoadError = true"
          @load="coverLoadError = false"
        />
        <div v-if="!modelValue" class="w-full h-full flex items-center justify-center text-[9px] text-gray-300 uppercase tracking-widest">
          无封面
        </div>
        <div v-if="coverLoadError && modelValue" class="absolute inset-0 flex items-center justify-center bg-gray-100 text-[9px] text-red-400 text-center px-2">
          加载失败
        </div>
      </div>
      <div class="flex-1 space-y-2">
        <div class="relative">
          <input
            type="text"
            :value="modelValue"
            @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
            placeholder="https://example.com/cover.jpg"
            class="w-full border-b border-gray-200 py-2 pr-6 focus:outline-none focus:border-black text-sm"
          />
          <button
            v-if="modelValue"
            @click="$emit('update:modelValue', '')"
            class="absolute right-0 top-1/2 -translate-y-1/2 text-gray-300 hover:text-black text-sm"
          >&times;</button>
        </div>
        <p class="text-[9px] text-gray-300">输入图片 URL 设置封面</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  modelValue?: string | null;
}>();

defineEmits<{
  'update:modelValue': [value: string];
}>();

const coverLoadError = ref(false);

watch(() => props.modelValue, () => {
  coverLoadError.value = false;
});
</script>
