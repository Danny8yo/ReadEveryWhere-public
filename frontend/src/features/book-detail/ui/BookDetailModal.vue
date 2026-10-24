<template>
  <UiOverlay
    :open="isOpen && !!book"
    kind="modal"
    width="920px"
    root-class="detail-modal"
    panel-class="detail-modal__panel"
    labelledby="book-detail-title"
    @close="emit('close')"
  >
    <BookDetailContent v-if="book" :is-open="isOpen" :book="book" :mode="mode" :library-book-id="libraryBookId" :deleted="deleted"
      :acquisition="{busy:isCurrentBookAdding,label:addButtonLabel,error:acquisitionError}"
      :detail="{baseUrl:zlibraryBaseUrl,error:detailError}" :persist-douban-selection="persistDoubanSelection"
      @add="add" @close="emit('close')" @read="emit('read',$event)"
      @douban-rating-selected="(id,rating)=>emit('doubanRatingSelected',id,rating)"
      @analyze="emit('analyze',$event)" @profile-updated="emit('profileUpdated',$event)"
      @edit="emit('edit')" @scrape="emit('scrape')" />
  </UiOverlay>
</template>
<script setup lang="ts">
// 浮层容器：桌面居中弹层，手机从底部弹出整页；保留 .detail-modal / .detail-modal__panel 类名（e2e 依赖）。
// 模板根节点不要放注释：会变成多根节点，组件测试的 wrapper 会落在注释上。
import { watch } from 'vue';
import BookDetailContent from './BookDetailContent.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';
import { showToast } from '../../../shared/web/toast';
import {useBookAcquisition} from '../web/useBookAcquisition';
import {useBookDetailActions} from '../web/useBookDetailActions';
import type {BookDetailModel} from '../model/bookDetail';
import type {DoubanRatingCandidate} from '../../metadata/model/metadata';
import type {FormalBookReadingProfile} from '../../metadata/model/bookAnalysis';
const props=withDefaults(defineProps<{isOpen:boolean;book:BookDetailModel|null;mode?:'search'|'library';libraryBookId?:number;
  /** 书架详情：这本书已在其他设备删除 */
  deleted?:boolean;
  /** 采集卡片上的“+”：值变化且详情已打开时立即开始入库 */
  autoAddToken?:number|null}>(),{mode:'search',autoAddToken:null,deleted:false});
const emit=defineEmits<{close:[];read:[book:BookDetailModel];doubanRatingSelected:[id:string,rating:DoubanRatingCandidate];analyze:[payload:{bookId:number;force:boolean}];profileUpdated:[profile:FormalBookReadingProfile];edit:[];scrape:[]}>();
const {isCurrentBookAdding,addButtonLabel,acquisitionError,handleAddToLibrary}=useBookAcquisition(()=>props.book,()=>emit('close'));
const {zlibraryBaseUrl,detailError,persistDoubanSelection}=useBookDetailActions(props,(id,rating)=>emit('doubanRatingSelected',id,rating));
// 画像抽屉也是 UiOverlay，打开后在浮层栈最上层，Esc 先交给它（它有未保存修改的确认）
// 入库前置校验（如缺少可入库格式）会直接抛错，之前是未处理的 Promise 拒绝，这里显示出来
async function add(){
  try{ await handleAddToLibrary(); }
  catch(error){ showToast(error instanceof Error?error.message:'加入书架失败','err'); }
}
watch(()=>props.autoAddToken,token=>{ if(token!==null&&props.isOpen&&props.book&&!isCurrentBookAdding.value) void add(); });
</script>
