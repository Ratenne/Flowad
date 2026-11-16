import { it,expect,vi } from 'vitest';
import { config,call,base } from './helpers';
it('redirects preview pages to the configured login origin before setting cookies',async()=>{
  const fetch=vi.fn();
  const e=config({API_PREFIX:'/flowad',FRONTEND_URL:'https://flowad.test/flowad/',TESLA_REDIRECT_URI:'https://flowad.test/flowad/api/tesla/callback',ASSETS:{fetch} as unknown as Fetcher});
  for(const path of ['/','/flowad','/flowad/','/flowad/tesla-check.html','/tesla-check.html']){
    const r=await call(path,undefined,{env:e,url:'https://preview.test'});
    expect(r.status).toBe(307);
    expect(r.headers.get('Location')).toBe('https://flowad.test/flowad/'+(path.includes('tesla-check')?'tesla-check.html':''));
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('serves unchanged frontend assets under /flowad while API stays in Hono',async()=>{
  const fetch=vi.fn(async(r:Request)=>new Response(new URL(r.url).pathname));
  const e=config({API_PREFIX:'/flowad',ASSETS:{fetch} as unknown as Fetcher});
  const root=await call('/flowad',undefined,{env:e});expect(root.status).toBe(308);expect(root.headers.get('Location')).toBe('https://flowad.test/flowad/');
  expect(await(await call('/flowad/',undefined,{env:e})).text()).toBe('/');
  expect(await(await call('/flowad/app.js',undefined,{env:e})).text()).toBe('/app.js');
  expect(await(await call('/flowad/tesla-check.html',undefined,{env:e})).text()).toBe('/tesla-check.html');
  expect((await call('/flowad/api/recommendations',base,{env:e})).status).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('keeps the context prefix on static asset canonical redirects',async()=>{
  const e=config({API_PREFIX:'/flowad',ASSETS:{fetch:async()=>new Response(null,{status:307,headers:{Location:'/tesla-check'}})} as unknown as Fetcher});
  const r=await call('/flowad/tesla-check.html',undefined,{env:e});expect(r.status).toBe(307);expect(r.headers.get('Location')).toBe('https://flowad.test/flowad/tesla-check');
});
