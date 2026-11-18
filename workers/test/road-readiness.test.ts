import {it,expect,vi} from 'vitest';
import {readyTable} from '../src/road-readiness';
import {Failure} from '../src/utils';
const url='https://roads.test/table/v1/driving/public-fixture';
it('keeps one operation pending through two throttled startup responses',async()=>{
 const request=vi.fn().mockResolvedValueOnce({status:429,data:null}).mockResolvedValueOnce({status:429,data:null}).mockResolvedValue({status:200,data:{code:'Ok'}});
 const wait=vi.fn(async()=>{});
 expect(await readyTable(url,undefined,8000,true,{request,wait})).toMatchObject({status:200});
 expect(request).toHaveBeenCalledTimes(3);expect(wait.mock.calls).toEqual([[30000,undefined],[30000,undefined]]);
});
it('waits only on safe transient reads and caps attempts',async()=>{
 const request=vi.fn().mockRejectedValueOnce(new Failure('UPSTREAM_TIMEOUT')).mockResolvedValue({status:503,data:null}),wait=vi.fn(async()=>{});
 expect(await readyTable(url,undefined,8000,true,{request,wait})).toMatchObject({status:503});
 expect(request).toHaveBeenCalledTimes(3);expect(wait).toHaveBeenCalledTimes(2);
});
it.each([
 {status:429,data:null,retryAfterSeconds:120},
 {status:429,data:null,challenged:true},
 {status:400,data:{code:'NoSegment'}},
 {status:403,data:null},
 {status:200,data:{code:'Ok'}}
])('does not retry a long allowance, challenge, bad request, permission failure or success: %j',async response=>{
 const request=vi.fn().mockResolvedValue(response),wait=vi.fn(async()=>{});
 expect(await readyTable(url,undefined,8000,true,{request,wait})).toEqual(response);expect(request).toHaveBeenCalledOnce();expect(wait).not.toHaveBeenCalled();
});
it('preserves an explicit short retry allowance',async()=>{
 const request=vi.fn().mockResolvedValueOnce({status:429,data:null,retryAfterSeconds:17}).mockResolvedValue({status:200,data:{code:'Ok'}}),wait=vi.fn(async()=>{});
 await readyTable(url,undefined,8000,true,{request,wait});expect(wait.mock.calls).toEqual([[17000,undefined]]);
});
it('does not change non-free configurations',async()=>{
 const request=vi.fn().mockResolvedValue({status:429,data:null}),wait=vi.fn(async()=>{});
 await readyTable(url,undefined,8000,false,{request,wait});expect(request).toHaveBeenCalledOnce();expect(wait).not.toHaveBeenCalled();
});
it('cleans the backoff timer when a browser cancels',async()=>{
 vi.useFakeTimers();
 try{
  const controller=new AbortController(),request=vi.fn().mockResolvedValue({status:429,data:null});
  const pending=readyTable(url,controller.signal,8000,true,{request});
  const checked=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(1);controller.abort();await checked;
  expect(request).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
