#!/usr/bin/env python3
"""Probe fixed public landmarks, never a user's coordinates."""
import argparse,json,time,urllib.request,urllib.error,ssl
try:
 import certifi
 tls=ssl.create_default_context(cafile=certifi.where())
except ImportError:
 tls=ssl.create_default_context()
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('base_url');p.add_argument('--output',default='artifacts/roads/probe.json');a=p.parse_args()
cases={
 'seoul':'126.978,37.5665;127.0276,37.4979',
 'busan':'129.0756,35.1796;129.1585,35.1587',
 'jeju':'126.5312,33.4996;126.5601,33.2469',
 'mainland_long':'126.978,37.5665;129.0756,35.1796',
 'roundtrip':'126.978,37.5665;127.0276,37.4979;126.978,37.5665',
}
results=[]
for name,xy in cases.items():
 url=a.base_url.rstrip('/')+'/route/v1/driving/'+xy+'?steps=true&geometries=geojson&overview=false'
 started=time.monotonic()
 with urllib.request.urlopen(url,timeout=180,context=tls) as r: data=json.load(r)
 route=data.get('routes',[{}])[0];legs=route.get('legs',[])
 assert data.get('code')=='Ok',(name,data.get('code'))
 assert len(legs)==xy.count(';'),name
 assert all(leg.get('distance',0)>0 and len(leg.get('steps',[]))>0 for leg in legs),name
 result={'case':name,'seconds':round(time.monotonic()-started,3),'distanceKm':round(route['distance']/1000,2),'legs':len(legs),'snapMeters':[round(w['distance'],2) for w in data['waypoints']]}
 results.append(result);print(json.dumps(result),flush=True)
for name,xy in [('invalid_latitude','127,91;127,37'),('waypoint_limit',';'.join(['127,37']*21))]:
 try:
  urllib.request.urlopen(a.base_url.rstrip('/')+'/route/v1/driving/'+xy,timeout=30,context=tls)
  raise AssertionError(name+' was accepted')
 except urllib.error.HTTPError as e:
  assert e.code==400,(name,e.code)
  results.append({'case':name,'httpStatus':400})
Path(a.output).parent.mkdir(parents=True,exist_ok=True);Path(a.output).write_text(json.dumps({'baseUrl':a.base_url,'tests':results},ensure_ascii=False,indent=2)+'\n')
