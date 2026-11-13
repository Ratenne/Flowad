import { env } from 'cloudflare:workers';
import { vi } from 'vitest';
import worker from '../src/index';
import type { Env, Session } from '../src/types';
import { Sessions } from '../src/repository';
import { now } from '../src/utils';
export const base={latitude:37.5665,longitude:126.978,availableMinutes:180,scenery:'forest',vehicleType:'ev'};
export function config(extra:Partial<Env>={}):Env{return {...env as unknown as Env,...extra};}
export async function call(path:string,body?:unknown,options:{method?:string;headers?:Record<string,string>;env?:Env;url?:string}={}){
  const headers={'Content-Type':'application/json',...options.headers};
  const r=new Request(`${options.url??'https://flowad.test'}${path}`,{method:options.method??(body===undefined?'GET':'POST'),headers,body:body===undefined?undefined:JSON.stringify(body)});
  return worker.fetch(r,options.env??config(),{} as ExecutionContext);
}
export function external(handler:(url:string,init?:RequestInit)=>Response|Promise<Response>){const fn=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>handler(String(input),init));vi.stubGlobal('fetch',fn);return fn;}
export const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
export async function authenticated(extra:Partial<Session>={},e=config()){
  const data:Session={csrf:'test-csrf',vehicles:{car:'TEST-VIN'},selected:'car',commands:true,locationGranted:true,tokens:{access:'test-access',refresh:'test-refresh',expires:now()+3600},...extra};
  const id=await new Sessions(e).create(data),headers={Cookie:`__Host-flowad=${id}`,'X-CSRF-Token':data.csrf};
  return {id,headers,env:e,post:(path:string,body:unknown={})=>call('/api/tesla/'+path,body,{headers,env:e})};
}
