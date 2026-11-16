import {z} from 'zod';
import type {Env} from './types';
import {coordinate} from './utils';
import {generate} from './dynamic-recommendations';
const weather=z.object({condition:z.enum(['sunny','cloudy','rainy']),temperatureC:z.number(),windMps:z.number().min(0),severe:z.boolean().nullish(),source:z.string().min(1).max(100).refine(s=>s.trim().length>0),observedAt:z.iso.datetime({offset:true}).nullish()});
export const recommendation=coordinate.extend({requestId:z.string().min(8).max(80).optional(),poiIds:z.array(z.string().min(1).max(150)).min(1).max(3).optional(),originSource:z.enum(['gps','tesla','pleos','manual','demo','unknown']).optional(),roundTrip:z.boolean().optional(),availableMinutes:z.number().int().min(1).max(1440),scenery:z.enum(['all','forest','coast','open']),vehicleType:z.enum(['ice','ev']),batteryPercent:z.number().min(0).max(100).nullish(),estimatedRangeKm:z.number().positive().max(2000).nullish(),weather:weather.nullish(),courseWeather:z.record(z.string(),weather.nullable()).refine(x=>Object.keys(x).length<=100).nullish(),originSevere:z.boolean().nullish(),walking:z.boolean().nullish(),departure:z.string().nullish(),returnLatitude:z.number().min(-90).max(90).nullish(),returnLongitude:z.number().min(-180).max(180).nullish()}).refine(r=>(r.returnLatitude==null)===(r.returnLongitude==null));
export type Input=z.infer<typeof recommendation>;
export function battery(r: {vehicleType:string;batteryPercent?:number|null;estimatedRangeKm?:number|null},km: number) {return r.vehicleType!=='ev'?'NOT_APPLICABLE':r.batteryPercent==null||r.estimatedRangeKm==null?'INSUFFICIENT_INPUT':r.batteryPercent-km*1.2/r.estimatedRangeKm*100<15?'CHARGING_MAY_BE_NEEDED':'ESTIMATED_SUFFICIENT';}
export async function recommend(r: Input, env: Env,signal?:AbortSignal) {
  return generate(r,env,signal);
}
