import {expect,it,vi} from 'vitest';
import worker from '../src/index';
import {keepaliveCron,recordExperimentTraffic,runRoadKeepalive} from '../src/road-keepalive';
import {osrmRequest} from '../src/road-provider';
import {call,config,external,json} from './helpers';

const starts=Date.parse('2026-11-20T00:00:00Z'),interval=600000,origin='https://flowad-roads.ravirgo.com';
function enabled(overrides:Parameters<typeof config>[0]={},review={}){
 return config({
  ROAD_ROUTING_URL:origin,ROAD_KEEPALIVE_ENABLED:'true',ROAD_KEEPALIVE_START_AT:new Date(starts).toISOString(),
  ROAD_KEEPALIVE_INTERVAL_MINUTES:'10',ROAD_KEEPALIVE_EXPERIMENT_DAYS:'3',
  ROAD_KEEPALIVE_REVIEW:JSON.stringify({checkedAt:new Date(starts).toISOString(),policyApproved:true,resourcesOk:true,
   freeHoursForExperiment:100,baselineSuccessRate:.9,...review}),...overrides
 });
}
const read=(env:ReturnType<typeof enabled>)=>env.DB.prepare('SELECT attempts,successes,rate_limits,failure_streak,stop_reason FROM road_keepalive_experiments').first();
const nearest={code:'Ok',waypoints:[{location:[126.978,37.5665],distance:4}]};
const ok=(cacheStatus='DYNAMIC')=>new Response(JSON.stringify(nearest),{
 headers:{'x-render-origin-server':'Render','rndr-id':'abcdabcd-abcd-1234','cf-cache-status':cacheStatus}
});
const cron=(name:string)=>({cron:name,scheduledTime:Date.now()}) as ScheduledController;

it('preserves cleanup and performs no road requests on the disabled Cron',async()=>{
 const env=enabled({ROAD_KEEPALIVE_ENABLED:'false'});
 const upstream=external(()=>ok());
 await env.DB.prepare('INSERT INTO rate_limits VALUES(?,?,?)').bind('old-test',1,1).run();
 await worker.scheduled(cron(keepaliveCron),env);
 expect(await env.DB.prepare('SELECT id FROM rate_limits WHERE id=?').bind('old-test').first()).toBeTruthy();
 await worker.scheduled(cron('*/30 * * * *'),env);
 expect(await env.DB.prepare('SELECT id FROM rate_limits WHERE id=?').bind('old-test').first()).toBeNull();
 expect(await read(env)).toBeNull();
 expect(upstream).not.toHaveBeenCalled();
});

it.each([{policyApproved:false},{resourcesOk:false},{freeHoursForExperiment:71},{checkedAt:'2026-11-18T00:00:00Z'}])(
 'fails closed when the operator review is unsuitable: %j',async review=>{
  vi.spyOn(Date,'now').mockReturnValue(starts);
  const upstream=external(()=>ok());
  await runRoadKeepalive(enabled({},review),starts);
  expect(upstream).not.toHaveBeenCalled();
 });

it('claims a single cache-bypassing origin Nearest per slot and stops on expiry',async()=>{
 const time=vi.spyOn(Date,'now').mockReturnValue(starts);
 const env=enabled(),upstream=external((url,init)=>{
  expect(url).toBe(origin+'/nearest/v1/driving/126.978,37.5665?number=1');
  expect(init?.cache).toBe('no-store');
  expect(init?.signal).toBeDefined();
  return ok();
 });
 await Promise.all([runRoadKeepalive(env,starts),runRoadKeepalive(env,starts)]);
 expect(upstream).toHaveBeenCalledOnce();
 expect(await read(env)).toMatchObject({attempts:1,successes:1});
 time.mockReturnValue(starts+3*86400000);
 await runRoadKeepalive(env,Date.now());
 expect(await read(env)).toMatchObject({stop_reason:'experiment_ended'});
 expect(upstream).toHaveBeenCalledOnce();
});

it.each([
 [{ROAD_KEEPALIVE_START_AT:undefined},'missing_start_at'],
 [{ROAD_KEEPALIVE_REVIEW:undefined},'missing_operator_review'],
 [{ROAD_KEEPALIVE_REVIEW:'{}'},'invalid_operator_review']
] as const)('logs the reason before the first experiment row exists',async(overrides,reason)=>{
 vi.spyOn(Date,'now').mockReturnValue(starts);
 const log=vi.spyOn(console,'log'),env=enabled(overrides),upstream=external(()=>ok());
 await worker.scheduled(cron(keepaliveCron),env);
 expect(log).toHaveBeenCalledWith(JSON.stringify({event:'osrm_keepalive_skip',reason}));
 expect(await read(env)).toBeNull();
 expect(upstream).not.toHaveBeenCalled();
});

it('shares 429 backoff and stops after a second probe 429 following expiry',async()=>{
 const time=vi.spyOn(Date,'now').mockReturnValue(starts);
 const env=enabled(),rate=()=>new Response('',{status:429,headers:{'Retry-After':'900'}});
 const upstream=external(rate);
 await runRoadKeepalive(env,starts);
 await expect(osrmRequest(env,origin+'/route/v1/driving/fixture',{})).rejects.toMatchObject({
  code:'ROAD_PROVIDER_RATE_LIMIT',retryAfterSeconds:900
 });
 time.mockReturnValue(starts+interval);
 await runRoadKeepalive(env,Date.now());
 expect(upstream).toHaveBeenCalledOnce();
 expect(await read(env)).toMatchObject({attempts:1,successes:0});
 time.mockReturnValue(starts+2*interval);
 const next=external(rate);
 await runRoadKeepalive(env,Date.now());
 expect(await read(env)).toMatchObject({attempts:2,rate_limits:2,stop_reason:'repeated_429'});
 time.mockReturnValue(starts+3*interval);
 await runRoadKeepalive(env,Date.now());
 expect(next).toHaveBeenCalledOnce();
});

it('resumes after both timers expire and counts a valid headerless Nearest only once',async()=>{
 const time=vi.spyOn(Date,'now').mockReturnValue(starts);
 const env=enabled(),upstream=external(()=>json(nearest));
 await env.DB.prepare('INSERT INTO road_provider_cooldown VALUES(?,?,?)').bind(origin,starts-1,starts+interval).run();
 await worker.scheduled(cron(keepaliveCron),env);
 expect(await read(env)).toMatchObject({attempts:0,successes:0});
 time.mockReturnValue(starts+interval);
 await Promise.all([worker.scheduled(cron(keepaliveCron),env),worker.scheduled(cron(keepaliveCron),env)]);
 expect(await read(env)).toMatchObject({attempts:1,successes:1});
 expect(await env.DB.prepare('SELECT origin FROM road_provider_cooldown').first()).toBeNull();
 expect(upstream).toHaveBeenCalledOnce();
 time.mockReturnValue(starts+2*interval);
 external(()=>json({code:'Ok',waypoints:[{}]}));
 await worker.scheduled(cron(keepaliveCron),env);
 expect(await read(env)).toMatchObject({attempts:2,successes:1});
});

it('skips recent foreground traffic and stops when the measured user success rate drops',async()=>{
 const time=vi.spyOn(Date,'now').mockReturnValue(starts);
 const env=enabled(),upstream=external(()=>ok());
 await runRoadKeepalive(env,starts);
 time.mockReturnValue(starts+interval);
 await recordExperimentTraffic(env,Date.now()-1000);
 await runRoadKeepalive(env,Date.now());
 expect(upstream).toHaveBeenCalledOnce();
 for(let i=0;i<20;i++)await recordExperimentTraffic(env,Date.now(),i<10?'success':'failure');
 time.mockReturnValue(starts+2*interval);
 await runRoadKeepalive(env,Date.now());
 expect(await read(env)).toMatchObject({attempts:1,stop_reason:'user_success_rate_declined'});
});

it('yields the first slot when a user request arrives before the first Cron',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(starts+1000);
 const env=enabled(),upstream=external(()=>ok());
 await recordExperimentTraffic(env,starts);
 await runRoadKeepalive(env,starts);
 expect(await read(env)).toMatchObject({attempts:0});
 expect(upstream).not.toHaveBeenCalled();
});

it('does not count cached responses as success and stops after three failed probes',async()=>{
 const time=vi.spyOn(Date,'now').mockReturnValue(starts);
 const env=enabled(),upstream=external(()=>ok('HIT'));
 await runRoadKeepalive(env,starts);
 expect(await read(env)).toMatchObject({attempts:1,successes:0,failure_streak:1});
 external(()=>new Response('',{status:502}));
 time.mockReturnValue(starts+interval);
 await runRoadKeepalive(env,Date.now());
 time.mockReturnValue(starts+2*interval);
 await runRoadKeepalive(env,Date.now());
 expect(await read(env)).toMatchObject({attempts:3,successes:0,stop_reason:'consecutive_probe_failures'});
 expect(upstream).toHaveBeenCalledOnce();
});

it('aborts a hanging Nearest at eight seconds without retrying',async()=>{
 vi.useFakeTimers();
 try{
  vi.setSystemTime(starts);
  const env=enabled();
  const upstream=external((_url,init)=>new Promise((_resolve,reject)=>{
   init?.signal?.addEventListener('abort',()=>reject(Error('timeout')),{once:true});
  }));
  const pending=runRoadKeepalive(env,starts);
  while(!upstream.mock.calls.length)await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(8000);
  await pending;
  expect(upstream).toHaveBeenCalledOnce();
  expect(await read(env)).toMatchObject({attempts:1,successes:0,failure_streak:1});
 }finally{vi.useRealTimers();}
});

it('logs a browser retry marker without disclosing the supplied ticket',async()=>{
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 const response=await call('/api/navigation/verify',{ticket:'private.ticket',manualRetry:true},{env:config({SAFE_UPSTREAM_DIAGNOSTICS:'true'})});
 expect(response.status).toBe(400);
 expect(log).toHaveBeenCalledWith(expect.stringContaining('"manualRetry":true'));
 expect(JSON.stringify(log.mock.calls)).not.toContain('private.ticket');
});
