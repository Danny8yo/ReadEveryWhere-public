import {describe,it,expect,vi} from 'vitest';
import {createAcquisitionController,createAcquisitionState,type AcquisitionGateway} from '../features/library/domain/acquisition';
import type {DownloadTask} from '../features/library/model/download';
import type {LibraryBook,AddFromSearchParams} from '../features/library/model/library';
import type {Scheduler} from '../shared/domain/scheduler';
const input:AddFromSearchParams={title:'Book',authors:[],sourcePlatform:'zlibrary',sourceBookId:'a',sourceUrl:'https://example.test/a',format:'epub'};
function setup(){
 const callbacks=new Map<number,()=>void>();let seq=0;
 const scheduler:Scheduler={setTimeout(cb){callbacks.set(++seq,cb);return seq;},clearTimeout(id){callbacks.delete(id)}};
 const api:AcquisitionGateway={add:vi.fn().mockResolvedValue({id:7} as LibraryBook),createTask:vi.fn().mockResolvedValue({id:8} as DownloadTask),getTask:vi.fn()};
 const state=createAcquisitionState(),completed=vi.fn();const controller=createAcquisitionController(state,api,scheduler,completed);
 async function tick(){const entry=callbacks.entries().next().value;if(!entry)throw new Error('没有安排轮询');callbacks.delete(entry[0]);entry[1]();await Promise.resolve();await Promise.resolve();}
 return {state,controller,api,completed,callbacks,tick};
}
describe('平台无关入库下载',()=>{
 it('网络错误是可重试失败，重试沿用任务且不重复入库',async()=>{
  const s=setup();vi.mocked(s.api.getTask).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({status:'completed'} as DownloadTask);
  await s.controller.add('a',input);await s.tick();
  expect(s.state.jobs.a).toMatchObject({phase:'poll_failed',taskId:8,bookId:7});expect(s.state.jobs.a.message).toContain('network');expect(s.completed).not.toHaveBeenCalled();
  await s.controller.add('a',input);await s.tick();expect(s.state.jobs.a.phase).toBe('completed');expect(s.api.add).toHaveBeenCalledTimes(1);expect(s.api.createTask).toHaveBeenCalledTimes(1);
 });
 it.each(['failed','canceled'] as const)('服务端 %s 结束观察并保留明确终态',async status=>{
  const s=setup();vi.mocked(s.api.getTask).mockResolvedValue({status,errorMessage:'source failure'} as DownloadTask);
  await s.controller.add('a',input);await s.tick();expect(s.state.jobs.a.phase).toBe(status);expect(s.completed).not.toHaveBeenCalled();expect(s.callbacks.size).toBe(0);
 });
 it('重复提交和慢请求不产生并发轮询',async()=>{
  const s=setup();let resolve!:(v:DownloadTask)=>void;vi.mocked(s.api.getTask).mockImplementation(()=>new Promise(r=>resolve=r));
  await Promise.all([s.controller.add('a',input),s.controller.add('a',input)]);await s.tick();
  expect(s.api.add).toHaveBeenCalledTimes(1);expect(s.callbacks.size).toBe(0);
  resolve({status:'downloading',progress:30} as DownloadTask);await Promise.resolve();expect(s.callbacks.size).toBe(1);
 });
 it('销毁后迟到结果不会关闭另一页面或重启轮询',async()=>{
  const s=setup();let resolve!:(v:DownloadTask)=>void;vi.mocked(s.api.getTask).mockImplementation(()=>new Promise(r=>resolve=r));
  await s.controller.add('a',input);await s.tick();s.controller.dispose();resolve({status:'completed'} as DownloadTask);await Promise.resolve();
  expect(s.completed).not.toHaveBeenCalled();expect(s.callbacks.size).toBe(0);
 });
 it('下载创建失败后重试复用已入库的书籍',async()=>{
  const s=setup();vi.mocked(s.api.createTask).mockRejectedValueOnce({message:'quota'}).mockResolvedValueOnce({id:9} as DownloadTask);
  await s.controller.add('a',input);expect(s.state.jobs.a.message).toContain('quota');await s.controller.add('a',input);expect(s.api.add).toHaveBeenCalledTimes(1);expect(s.state.jobs.a.taskId).toBe(9);
 });
});
