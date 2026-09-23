<template>
  <BookDetailContent :is-open="isOpen" :book="book" :mode="mode" :library-book-id="libraryBookId"
    :acquisition="{busy:isCurrentBookAdding,label:addButtonLabel,error:acquisitionError}"
    :detail="{baseUrl:zlibraryBaseUrl,error:detailError}" :persist-douban-selection="persistDoubanSelection"
    @add="handleAddToLibrary" @close="emit('close')" @read="emit('read',$event)"
    @douban-rating-selected="(id,rating)=>emit('doubanRatingSelected',id,rating)"
    @analyze="emit('analyze',$event)" @profile-updated="emit('profileUpdated',$event)" />
</template>
<script setup lang="ts">
import BookDetailContent from './library/BookDetailContent.vue';
import {useBookAcquisition} from '../features/library/web/useBookAcquisition';
import {useBookDetailActions} from '../features/library/web/useBookDetailActions';
import type {BookDetailModel} from '../shared/model/bookDetail';
import type {DoubanRatingCandidate} from '../features/metadata/model/metadata';
import type {FormalBookReadingProfile} from '../features/metadata/model/bookAnalysis';
const props=withDefaults(defineProps<{isOpen:boolean;book:BookDetailModel|null;mode?:'search'|'library';libraryBookId?:number}>(),{mode:'search'});
const emit=defineEmits<{close:[];read:[book:BookDetailModel];doubanRatingSelected:[id:string,rating:DoubanRatingCandidate];analyze:[payload:{bookId:number;force:boolean}];profileUpdated:[profile:FormalBookReadingProfile]}>();
const {isCurrentBookAdding,addButtonLabel,acquisitionError,handleAddToLibrary}=useBookAcquisition(()=>props.book,()=>emit('close'));
const {zlibraryBaseUrl,detailError,persistDoubanSelection}=useBookDetailActions(props,(id,rating)=>emit('doubanRatingSelected',id,rating));
</script>
