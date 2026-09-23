import {describe,it,expect,vi} from 'vitest';
import {createReadingSession,createReadingSessionState} from '../features/reader/domain/session';
import {createBatchReviewController,createBatchReviewState,type MetadataGateway} from '../features/metadata/domain/batchReview';
import {createLibraryController,createLibraryState,type LibraryGateway} from '../features/library/domain/library';
import {createConversationController,createConversationState} from '../features/ai-reading/domain/conversation';
import type {ReadingConversationGateway} from '../features/ai-reading/domain/ports';
import type {ReadingConversationPage} from '../features/ai-reading/model/aiReading';
import type {ReaderPort} from '../features/reader/domain/ReaderPort';
import type {ReadingStateSnapshot} from '../features/reader/model/readingState';
import type {LibraryBook,LibraryListResponse} from '../features/library/model/library';
import type {MatchedMetadataCandidate} from '../features/metadata/model/metadata';
const deferred=<T>()=>{let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const book={id:1,userId:1,title:'书',authors:[],version:3} as unknown as LibraryBook;
const snapshot:ReadingStateSnapshot={revision:1,progress:null,bookmarks:[],annotations:[]};
const candidate={candidate:{title:'候选',authors:[],language:'zh',sourcePlatform:'douban',sourceBookId:'s',publishYear:null,coverUrl:null,description:null,publisher:null,isbn:null,editionTag:null,sourceUrl:null},match:{level:'edition',signals:[],conflicts:[]}} as MatchedMetadataCandidate;
describe('阅读会话边界',()=>{
 it('服务端快照失败不会进入 ready，也不会连接 SSE',async()=>{
  const state=createReadingSessionState(),sync={load:vi.fn().mockRejectedValue(new Error('state unavailable')),connect:vi.fn(),dispose:vi.fn()};
  const session=createReadingSession(state,()=>({} as ReaderPort),sync);
  await expect(session.initialize(vi.fn(),vi.fn())).rejects.toThrow('state unavailable');expect(state.status).toBe('failed');expect(state.error).toContain('state unavailable');expect(sync.connect).not.toHaveBeenCalled();
 });
 it('关闭后迟到的快照不恢复旧书',async()=>{
  const pending=deferred<ReadingStateSnapshot>(),state=createReadingSessionState(),apply=vi.fn(),sync={load:()=>pending.promise,connect:vi.fn(),dispose:vi.fn()};
  const session=createReadingSession(state,()=>({} as ReaderPort),sync);const opening=session.initialize(apply,vi.fn());session.close();pending.resolve(snapshot);
  await expect(opening).rejects.toThrow('关闭');expect(apply).not.toHaveBeenCalled();expect(state.status).toBe('closed');
 });
 it('目录定位成功和失败都等待异步引擎结果',async()=>{
  const navigate=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('missing href'));
  const state=createReadingSessionState(),session=createReadingSession(state,()=>({goToHref:navigate} as unknown as ReaderPort),{load:async()=>snapshot,connect:vi.fn(),dispose:vi.fn()});
  await session.initialize(vi.fn(),async()=>{});expect(await session.navigate('a')).toBe(true);expect(await session.navigate('b')).toBe(false);expect(state.navigationError).toContain('missing href');
 });
});
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
describe('书架请求归属',()=>{
 it('筛选切换后旧列表不会覆盖新结果，后台错误保留列表并显示错误',async()=>{
  const old=deferred<LibraryListResponse>(),state=createLibraryState();
  const fetch=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({items:[{...book,id:2}],page:1,pageSize:20,total:1}).mockRejectedValueOnce({message:'network'});
  const controller=createLibraryController(state,{fetchLibraryBooks:fetch} as unknown as LibraryGateway<unknown>);
  const first=controller.loadLibrary({keyword:'old'});await controller.loadLibrary({keyword:'new'});old.resolve({items:[book],total:1,page:1,pageSize:20});await first;expect(state.books[0].id).toBe(2);
  await expect(controller.loadLibrary({}, {silent:true})).rejects.toEqual({message:'network'});expect(state.books[0].id).toBe(2);expect(state.error).toBe('network');
 });
});
describe('AI 会话归属',()=>{
 it('销毁后历史请求不能写回旧会话',async()=>{
  const pending=deferred<ReadingConversationPage>(),state=createConversationState();
  const controller=createConversationController(state,{listConversations:()=>pending.promise} as unknown as ReadingConversationGateway,{setTimeout:()=>1,clearTimeout:()=>{}},()=>1);
  const reading=controller.loadHistory();controller.dispose();pending.resolve({items:[{id:'old'}],total:1} as ReadingConversationPage);await reading;expect(state.conversations).toEqual([]);
 });
 it('正在创建时拒绝重复发送',async()=>{
  const state=createConversationState();state.creating=true;const create=vi.fn();
  const controller=createConversationController(state,{createConversation:create} as unknown as ReadingConversationGateway,{setTimeout:()=>1,clearTimeout:()=>{}},()=>1);
  await controller.startConversation('hello',{budgetTier:'quick',budgetMode:'preset',budgetPolicy:{maxModelTurns:60,maxToolCalls:90,maxReadCharacters:250000,maxDurationMs:1800000,maxDelegatedAgents:4,maxConcurrentAgents:2}});expect(create).not.toHaveBeenCalled();
 });
});
it('clamps a page beyond the new last page with an existing displayed result',async()=>{
 const state=createLibraryState();state.books=[{id:7}] as any;state.activeQuery={page:3,pageSize:20};
 const fetch=vi.fn().mockResolvedValueOnce({items:[],total:21,page:3,pageSize:20}).mockResolvedValueOnce({items:[{id:8}],total:21,page:2,pageSize:20});
 const controller=createLibraryController(state,{fetchLibraryBooks:fetch} as unknown as LibraryGateway<unknown>);
 await controller.loadLibrary();expect(fetch).toHaveBeenCalledTimes(2);expect(state.pagination.page).toBe(2);expect(state.loading).toBe(false);expect(state.books[0].id).toBe(8);
});
