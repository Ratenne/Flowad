import type { Env } from './types';
import { cleanup } from './repository';
import {createApiApp} from './http-app';
import {mountRecommendationApi} from './recommendation-api';
import { tesla } from './tesla';
import { charging } from './charging';
import { locations } from './location';
const methods:Record<string,'GET'|'POST'>={
  '/api/recommendations':'POST','/api/navigation/resolve':'POST','/api/navigation/verify':'POST','/api/charging/recommendations':'POST',
  '/api/location/address':'POST','/api/location/juso-map':'POST',
  ...Object.fromEntries(['status','callback','authorize','disconnect','vehicles','select','reading','location','navigation/preview','navigation/destination/preview','navigation/send','navigation/confirm'].map(p=>['/api/tesla/'+p,p==='status'||p==='callback'?'GET':'POST'])) as Record<string,'GET'|'POST'>
};
export const app=createApiApp(methods);
mountRecommendationApi(app);
app.route('/api/tesla',tesla);app.route('/api/charging',charging);app.route('/api/location',locations);
export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext){
    const u=new URL(request.url),prefix=env.API_PREFIX??'';
    if(env.ASSETS&&!u.pathname.startsWith('/api/')&&!u.pathname.startsWith(prefix+'/api/')){
      if(prefix&&(u.pathname===prefix||u.pathname==='/'))return Response.redirect(new URL(prefix+'/',u).href,308);
      if(prefix&&u.pathname.startsWith(prefix+'/'))u.pathname=u.pathname.slice(prefix.length);
      const response=await env.ASSETS.fetch(new Request(u,request)),location=response.headers.get('Location');
      if(prefix&&location&&response.status>=300&&response.status<400){
        const target=new URL(location,u);
        if(target.origin===u.origin&&target.pathname!==prefix&&!target.pathname.startsWith(prefix+'/')){
          target.pathname=prefix+target.pathname;const headers=new Headers(response.headers);headers.set('Location',target.href);
          return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
        }
      }
      return response;
    }
    if(u.pathname.endsWith('/api/tesla/callback')&&env.TESLA_REDIRECT_URI){
      const registered=new URL(env.TESLA_REDIRECT_URI);
      if(u.origin!==registered.origin||u.pathname!==registered.pathname)return Response.json({error:'INVALID_STATE'},{status:400,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    }
    if(prefix&&u.pathname.startsWith(prefix+'/api/')){u.pathname=u.pathname.slice(prefix.length);request=new Request(u,request);}
    return app.fetch(request,env,ctx);
  },
  async scheduled(_event:ScheduledController,env:Env){await cleanup(env);}
} satisfies ExportedHandler<Env>;
