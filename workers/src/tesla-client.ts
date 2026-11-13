import { z } from 'zod';
import type { Env, Session } from './types';
import type { Lease } from './repository';
import { Failure, httpJson, httpsBase, now } from './utils';
export const AUDIENCE='https://fleet-api.prd.na.vn.cloud.tesla.com';
export const TOKEN='https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token';
const tokens=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1),expires_in:z.number().int().positive(),scope:z.string().optional()});
export type TokenResponse=z.infer<typeof tokens>;
export function configured(e: Env) {return !!(e.TESLA_CLIENT_ID&&e.TESLA_CLIENT_SECRET&&e.TESLA_REDIRECT_URI);}
export function acceptTokens(s: Session, raw: unknown): TokenResponse {
  const parsed=tokens.safeParse(raw);if(!parsed.success)throw new Failure('TOKEN_RESPONSE_INVALID');
  const t=parsed.data;s.tokens={access:t.access_token,refresh:t.refresh_token,expires:now()+t.expires_in};return t;
}
export function hasScope(t: TokenResponse, scope: string){return t.scope===undefined||t.scope.split(/\s+/).includes(scope);}
export class TeslaClient {
  constructor(private env: Env, private lease: Lease) {}
  async token(fields: Record<string,string>) {return this.request(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString()});}
  async access() {
    const s=this.lease.data;
    if(!s.tokens)throw new Failure('NOT_CONNECTED');
    if(now()>=s.tokens.expires-30){
      const refresh=s.tokens.refresh;
      // Persist consumption BEFORE single-use refresh. A crash/timeout requires login,
      // never a second use of an upstream refresh token with an unknown outcome.
      delete s.tokens;await this.lease.save();
      try {
        const t=acceptTokens(s,await this.token({grant_type:'refresh_token',client_id:this.env.TESLA_CLIENT_ID??'',refresh_token:refresh}));
        s.locationGranted=!!s.locationGranted&&hasScope(t,'vehicle_location');
        s.commands=!!s.commands&&hasScope(t,'vehicle_cmds');await this.lease.save();
      } catch {s.vehicles={};delete s.selected;delete s.tokens;await this.lease.save();throw new Failure('REAUTH_REQUIRED');}
    }
    return s.tokens!.access;
  }
  async get(path: string) {
    return this.request(AUDIENCE+path,{headers:{Authorization:`Bearer ${await this.access()}`}});
  }
  async command(path: string, body: unknown) {
    if(!path.endsWith('/command/navigation_request'))throw new Failure('UNSUPPORTED_COMMAND');
    const base=this.env.TESLA_COMMAND_PROXY_URL?httpsBase(this.env.TESLA_COMMAND_PROXY_URL):AUDIENCE;
    if(new URL(base).pathname!=='/')throw new Failure('NOT_CONFIGURED',503);
    return this.request(base+path,{method:'POST',headers:{Authorization:`Bearer ${await this.access()}`,'Content-Type':'application/json'},body:JSON.stringify(body)},true);
  }
  private async request(url: string, init: RequestInit, command=false): Promise<unknown> {
    try {
      const r=await httpJson(url,init,10000),status=r.status,path=new URL(url).pathname;
      if(this.env.SAFE_UPSTREAM_DIAGNOSTICS==='true'){
        // Status-only audit. Never log URL (VIN), query, body, code or tokens.
        const operation=path.endsWith('/token')?'oauth_token':path==='/api/1/vehicles'?'vehicles':path.endsWith('/vehicle_data_cached')?'reading':path.endsWith('/vehicle_data')?'location':command?'navigation_request':'vehicle_info';
        console.info(JSON.stringify({event:'tesla_upstream_http',operation,httpStatus:status}));
      }
      if(status===401){delete this.lease.data.tokens;this.lease.data.vehicles={};delete this.lease.data.selected;throw new Failure('REAUTH_REQUIRED');}
      if(status===403)throw new Failure('PERMISSION_DENIED');
      if(status===404)throw new Failure('NO_DATA');
      if(status===412)throw new Failure(path.endsWith('/vehicle_data_cached')?'NO_DATA':'PRECONDITION_FAILED');
      if(status===402)throw new Failure('PAYMENT_REQUIRED');
      if(status===421)throw new Failure('INCORRECT_REGION');
      if(status===408||status===429||status>=500)throw new Failure(command?'COMMAND_RESULT_UNKNOWN':'SERVICE_UNAVAILABLE');
      if(status<200||status>=300)throw new Failure('REQUEST_FAILED');
      if(r.data===null)throw new Failure(command?'COMMAND_RESULT_UNKNOWN':'SERVICE_UNAVAILABLE');
      return r.data;
    } catch(e) {if(e instanceof Failure){if(e.code==='UPSTREAM_TIMEOUT')throw new Failure(command?'COMMAND_TIMEOUT':'SERVICE_UNAVAILABLE');if(command&&['SERVICE_UNAVAILABLE','RESPONSE_TOO_LARGE'].includes(e.code))throw new Failure('COMMAND_RESULT_UNKNOWN');throw e;}throw new Failure(command?'COMMAND_RESULT_UNKNOWN':'SERVICE_UNAVAILABLE');}
  }
}
