"""Build small, georeferenced course terrain snapshots from public DEM + OSM roads.
No user locations are used. Sources are cached and provenance accompanies each file.
"""
import json,math,urllib.request,urllib.parse,time,hashlib,concurrent.futures,threading,datetime
from pathlib import Path
from PIL import Image
from copernicus_source import sample_grid
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'/'terrain';OUT.mkdir(exist_ok=True)
CACHE=Path('/workspace/scratch/debf1c22834c/terrain-cache');CACHE.mkdir(exist_ok=True)
UA='GilGyeolPrototype/0.1 (+https://gil-gyeol-drive.o94777.chatgpt.site)'
R=6378137;N=129
# Named area anchors: routing snaps these to OSM roads. They are not entrance/parking claims.
COURSES={
 'yangpyeong':[('양수리 주변',127.322,37.543),('서종 주변',127.349,37.606),('서후리 주변',127.430,37.616)],
 'paju':[('문산 주변',126.785,37.857),('임진각 주변',126.740,37.889),('파주 들판',126.773,37.873)],
 'siheung':[('물왕 주변',126.840,37.381),('오이도 주변',126.688,37.346),('배곧 해안 주변',126.716,37.370)],
 'gapyeong':[('청평 주변',127.425,37.737),('호명산 주변',127.494,37.742),('청평호 주변',127.486,37.702)],
 'gangneung-coast':[('사천항 주변',128.874,37.839),('영진 해안 주변',128.844,37.867),('연곡 주변',128.827,37.862)],
 'gangneung-forest':[('경포호 주변',128.898,37.795),('초당 주변',128.914,37.787),('강문 주변',128.922,37.797)],
 'daegwallyeong':[('옛길 주변',128.765,37.738),('대관령 주변',128.754,37.693),('횡계 주변',128.706,37.686)],
 'busan-coast':[('일광 주변',129.233,35.264),('칠암 주변',129.261,35.298),('임랑 주변',129.264,35.319)],
 'busan-forest':[('양산 숲길',129.038,35.365),('내원사 주변',129.080,35.427),('하북 주변',129.088,35.464)],
 'busan-open':[('대동 주변',128.981,35.242),('상동 주변',128.961,35.285),('생림 주변',128.914,35.328)]}
def merc(lon,lat):return [R*math.radians(lon),R*math.asinh(math.tan(math.radians(lat)))]
def lnglat(x,y):return [math.degrees(x/R),math.degrees(math.atan(math.sinh(y/R)))]
def request(url,path,post=None,timeout=28):
 if path.exists():return path.read_bytes()
 err=None
 for attempt in range(3):
  try:
   req=urllib.request.Request(url,data=post,headers={'User-Agent':UA})
   with urllib.request.urlopen(req,timeout=timeout) as response:data=response.read()
   path.write_bytes(data);return data
  except Exception as e:err=e;time.sleep(.5+attempt)
 raise err
def simplify(points,tolerance):
 if len(points)<3:return points
 a,b=points[0],points[-1];dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
 best,idx=0,0
 for i,p in enumerate(points[1:-1],1):
  t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
  d=math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t)
  if d>best:best,idx=d,i
 if best<=tolerance:return [a,b]
 return simplify(points[:idx+1],tolerance)[:-1]+simplify(points[idx:],tolerance)
def build(id,anchors):
 print('BUILD',id,flush=True)
 coords=';'.join(f'{lon},{lat}' for _,lon,lat in anchors)
 routing_url='https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=false'
 response=json.loads(request(routing_url,CACHE/f'osrm-{id}.json'))
 if response.get('code')!='Ok' or not response.get('routes'):raise ValueError('Routing failed: '+id)
 route=response['routes'][0];road=route['geometry']['coordinates'];projected=[merc(*p) for p in road]
 west=min(p[0] for p in projected);east=max(p[0] for p in projected);south=min(p[1] for p in projected);north=max(p[1] for p in projected)
 center=[(west+east)/2,(south+north)/2];span=max(east-west,north-south);pad=max(1300,span*.17)
 # Use a consistent ground aspect and enough context to see neighboring ridgelines.
 w=max(east-west+pad*2,(north-south+pad*2)*1.15,4200);h=max(north-south+pad*2,w/1.28)
 b=[center[0]-w/2,center[1]-h/2,center[0]+w/2,center[1]+h/2]
 lonlatSW=lnglat(b[0],b[1]);lonlatNE=lnglat(b[2],b[3]);elevations,dem_assets=sample_grid(b,N)
 if not all(-500<z<9000 for z in elevations):raise ValueError('Invalid DEM')
 water=[];water_ok=False
 snapped=[]
 for (label,lon,lat),wp in zip(anchors,response['waypoints']):snapped.append({'label':label,'coordinate':wp['location'],'snap_distance_m':round(wp.get('distance',0),1)})
 routepoints=simplify(projected,12)
 road_m=[[round(x,2),round(y,2)] for x,y in routepoints]
 data={'version':1,'courseId':id,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'grid':{'width':N,'height':N,'boundsMercator':b,'elevations':elevations,'spacingGroundMeters':round(max(w,h)/(N-1)*math.cos(math.radians((lonlatSW[1]+lonlatNE[1])/2))), 'sourceResolutionMeters':90},'bounds':[lonlatSW[0],lonlatSW[1],lonlatNE[0],lonlatNE[1]],'elevationRange':[min(elevations),max(elevations)],'road':{'coordinatesMercator':road_m,'distanceMeters':round(route['distance']),'durationSeconds':round(route['duration']),'anchors':snapped,'kind':'highlight_segment'},'water':water,'provenance':{'elevation':'Copernicus DEM GLO-90 (2021 release) / Airbus D&S','elevationUrl':'https://registry.opendata.aws/copernicus-dem/','elevationModel':'DSM: surface including vegetation and infrastructure','roads':'© OpenStreetMap contributors; OSRM routing','roadsUrl':'https://www.openstreetmap.org/copyright','routingUrl':routing_url,'waterSource':'OpenStreetMap / Overpass' if water_ok else None,'waterAvailable':water_ok,'demAssets':dem_assets,'verticalExaggeration':2,'displayChanges':'Bilinear sampling to a Web Mercator grid; vertical exaggeration 2x; sea-level areas flattened for display.','attribution':'produced using Copernicus WorldDEM™-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.','liability':'The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM™-90.','licenseUrl':'https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf','notNavigation':True}}
 raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();(OUT/f'{id}.json').write_bytes(raw)
 print('DONE',id,'grid',N,'range',data['elevationRange'],'road',round(route['distance']/1000,1),'km','water',len(water),'bytes',len(raw),flush=True)
 return {'id':id,'file':id+'.json','sha256':hashlib.sha256(raw).hexdigest(),'elevationRange':data['elevationRange'],'roadKm':round(route['distance']/1000,1),'waterAvailable':water_ok}
if __name__=='__main__':
 manifest=[]
 for id,anchors in COURSES.items():manifest.append(build(id,anchors))
 (OUT/'index.json').write_text(json.dumps({'version':1,'courses':manifest},ensure_ascii=False,indent=2))
 print('COMPLETE',len(manifest),'courses',flush=True)
