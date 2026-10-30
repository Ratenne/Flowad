export function assessBattery({routeStatus, distanceKm, batteryPercent, remainingRangeKm, reservePercent, observedAt, now=Date.now()}) {
 if(routeStatus!=='ROAD_ROUTED') return {status:'ROAD_ROUTE_REQUIRED'};
 if(![distanceKm,batteryPercent,remainingRangeKm,reservePercent].every(Number.isFinite)||distanceKm<0||batteryPercent<=0||batteryPercent>100||remainingRangeKm<=0||reservePercent<0||reservePercent>=batteryPercent||!Number.isFinite(observedAt)||observedAt>now+60000) return {status:'INSUFFICIENT_INPUT'};
 if(now-observedAt>15*60*1000)return {status:'STALE_DATA'};
 const usableKm=remainingRangeKm*(batteryPercent-reservePercent)/batteryPercent/1.2;
 return {status:usableKm>=distanceKm?'ESTIMATED_SUFFICIENT':'CHARGING_MAY_BE_NEEDED',usableKm:Math.round(usableKm),reservePercent};
}
