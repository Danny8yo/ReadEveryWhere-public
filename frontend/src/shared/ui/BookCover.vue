<template>
  <div class="book-cover" :style="style">
    <img
      v-if="coverUrl && !failed"
      class="book-cover__img"
      :src="coverUrl"
      :alt="alt ?? title"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <div v-else class="book-cover__generated" role="img" :aria-label="alt ?? title">
      <!-- 书名和作者用 CSS 画出来（content: attr()），不进 DOM 文本：
           页面上书名只出现一次，按书名查找元素（测试、浏览器查找）不会命中两处 -->
      <span class="book-cover__dot" aria-hidden="true" />
      <span class="book-cover__title" aria-hidden="true" :data-text="title" />
      <span v-if="author" class="book-cover__author" aria-hidden="true" :data-text="author" />
    </div>
    <!-- 角标、进度线、勾选圈等叠加物；本组件自成一层，叠加物的 z-index 不会越出封面 -->
    <slot />
  </div>
</template>

<script setup lang="ts">
// 书籍封面：有图显示图；没有封面或加载失败（外站防盗链、地址失效）时显示按书名生成的排版封面。
import { computed, ref, watch } from 'vue';
import { coverPalette, coverTitleSize } from '../utils/coverPalette';

const props = defineProps<{
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  alt?: string;
}>();

const failed = ref(false);
watch(() => props.coverUrl, () => { failed.value = false; });

const style = computed(() => {
  const palette = coverPalette(props.title);
  return {
    '--cover-base': palette.base,
    '--cover-glow': palette.glow,
    '--cover-title-size': `${coverTitleSize(props.title)}cqw`,
  };
});
</script>

<style scoped>
.book-cover {
  position: relative;
  isolation: isolate;
  container-type: inline-size;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: var(--ui-radius-cover);
  background: var(--cover-base);
}
.book-cover__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.book-cover__generated {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 6cqw;
  padding: 11% 10%;
  color: #fff;
  font-family: var(--ui-font-sans);
  background:
    radial-gradient(90% 60% at 15% 10%, color-mix(in srgb, var(--cover-glow) 75%, #fff), transparent 60%),
    linear-gradient(160deg, var(--cover-base), color-mix(in srgb, var(--cover-base) 55%, #000));
}
/* 注意：封面里的文字字号必须用 cqw，不能用 cqi（竖排时 cqi 会按视口计算，见计划 3.4） */
.book-cover__dot {
  position: absolute;
  left: 10%;
  top: 11%;
  width: 16cqw;
  height: 16cqw;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
}
.book-cover__title {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--cover-title-size);
  font-weight: 900;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.book-cover__title::before,
.book-cover__author::before {
  content: attr(data-text);
}
.book-cover__author {
  font-size: 7.5cqw;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
