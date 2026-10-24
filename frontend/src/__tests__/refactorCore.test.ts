import {describe,it,expect,vi} from 'vitest';
import {createBatchReviewController,createBatchReviewState,type MetadataGateway} from '../features/metadata/domain/batchReview';
import type {LibraryBook} from '../features/library/model/library';
import type {MatchedMetadataCandidate} from '../features/metadata/model/metadata';
const deferred=<T>()=>{let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const book={id:1,userId:1,title:'书',authors:[],version:3} as unknown as LibraryBook;
const candidate={candidate:{title:'候选',authors:[],language:'zh',sourcePlatform:'douban',sourceBookId:'s',publishYear:null,coverUrl:null,description:null,publisher:null,isbn:null,editionTag:null,sourceUrl:null},match:{level:'edition',signals:[],conflicts:[]}} as MatchedMetadataCandidate;
// 书架请求归属、阅读会话的测试已迁到 features/library/__tests__/libraryController.test.ts 与 features/reader/__tests__/readingSession.test.ts。
describe('批量元数据核心',()=>{
 it('候选先审核再应用，保留候选对应 version 并暴露冲突',async()=>{
  const state=createBatchReviewState(),apply=vi.fn().mockRejectedValue({message:'BOOK_VERSION_CONFLICT'}),events=vi.fn();
  const api:MetadataGateway={reloadBook:async()=>book,scrapeMetadata:async()=>[candidate],applyMetadataToBook:apply};
  const session=createBatchReviewController(state,{books:[book],provider:'douban'},api,events);await session.collectCandidates();expect(apply).not.toHaveBeenCalled();
  await session.applyConfirmed();expect(apply).toHaveBeenCalledWith(1,3,candidate.candidate);expect(state.entries[0].status).toBe('apply_failed');expect(state.entries[0].error).toContain('BOOK_VERSION_CONFLICT');
 });
 it('关闭后不继续检索后续书籍，也不发出迟到进度',async()=>{
  const pending=deferred<MatchedMetadataCandidate[]>(),api={reloadBook:async()=>book,scrapeMetadata:vi.fn(()=>pending.promise),applyMetadataToBook:vi.fn()},state=createBatchReviewState(),events=vi.fn();
  const session=createBatchReviewController(state,{books:[book,{...book,id:2}],provider:'douban'},api,events);
  const collecting=session.collectCandidates();session.dispose();const count=events.mock.calls.length;pending.resolve([candidate]);await collecting;
  expect(api.scrapeMetadata).toHaveBeenCalledTimes(1);expect(events).toHaveBeenCalledTimes(count);expect(state.collecting).toBe(false);
 });
});
