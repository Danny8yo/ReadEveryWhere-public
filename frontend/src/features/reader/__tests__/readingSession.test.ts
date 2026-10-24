import {describe,it,expect,vi} from 'vitest';
import {createReadingSession,createReadingSessionState} from '../domain/session';
import type {ReaderPort} from '../domain/ReaderPort';
import type {ReadingStateSnapshot} from '../model/readingState';
const deferred=<T>()=>{let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const snapshot:ReadingStateSnapshot={revision:1,progress:null,bookmarks:[],annotations:[]};
// 编号对应 doc/同步测试用例审查.md
describe('阅读会话（开书流程）',()=>{
 it('G9 开书时快照拉取失败 → 进入失败状态并显示原因，不连接推送',async()=>{
  const state=createReadingSessionState(),sync={load:vi.fn().mockRejectedValue(new Error('state unavailable')),connect:vi.fn(),dispose:vi.fn()};
  const session=createReadingSession(state,()=>({} as ReaderPort),sync);
  await expect(session.initialize(vi.fn(),vi.fn())).rejects.toThrow('state unavailable');expect(state.status).toBe('failed');expect(state.error).toContain('state unavailable');expect(sync.connect).not.toHaveBeenCalled();
 });
 it('G10 开书过程中关闭阅读器 → 迟到的快照不会恢复旧书',async()=>{
  const pending=deferred<ReadingStateSnapshot>(),state=createReadingSessionState(),apply=vi.fn(),sync={load:()=>pending.promise,connect:vi.fn(),dispose:vi.fn()};
  const session=createReadingSession(state,()=>({} as ReaderPort),sync);const opening=session.initialize(apply,vi.fn());session.close();pending.resolve(snapshot);
  await expect(opening).rejects.toThrow('关闭');expect(apply).not.toHaveBeenCalled();expect(state.status).toBe('closed');
 });
 // 以下不属于同步清单，随阅读会话一起迁移。
 it('目录定位成功和失败都等待异步引擎结果',async()=>{
  const navigate=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('missing href'));
  const state=createReadingSessionState(),session=createReadingSession(state,()=>({goToHref:navigate} as unknown as ReaderPort),{load:async()=>snapshot,connect:vi.fn(),dispose:vi.fn()});
  await session.initialize(vi.fn(),async()=>{});expect(await session.navigate('a')).toBe(true);expect(await session.navigate('b')).toBe(false);expect(state.navigationError).toContain('missing href');
 });
});
