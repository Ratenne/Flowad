"""Build national static terrain coverage from the public POI footprint.
No visitor coordinate and no runtime DEM requests. Resumable, with explicit gaps.
"""
import argparse,datetime,json,math,sqlite3
from pathlib import Path
import copernicus_source as dem
from poi_pipeline import fetch
R=6378137;W=math.pi*R
def main():
 p=argparse.ArgumentParser();p.add_argument('--db',default='data/generated/pois.sqlite');p.add_argument('--cache',default='data/raw/dem');p.add_argument('--output',default='dist/terrain/tiles');p.add_argument('--zoom',type=int,default=10);a=p.parse_args()
 dem.CACHE=Path(a.cache);dem.CACHE.mkdir(parents=True,exist_ok=True)
 out=Path(a.output);out.mkdir(parents=True,exist_ok=True);n=2**a.zoom;keys=set()
 db=sqlite3.connect(a.db)
 for lat,lon in db.execute('SELECT p.latitude,p.longitude FROM pois p JOIN poi_provider_state s ON s.active_dataset=p.dataset_id'):
  mx=R*math.radians(lon);my=R*math.asinh(math.tan(math.radians(lat)));x=int((mx+W)/(2*W)*n);y=int((W-my)/(2*W)*n)
  for dx in [-1,0,1]:
   for dy in [-1,0,1]:keys.add((x+dx,y+dy))
 if not keys:raise RuntimeError('NO_ACTIVE_NATIONAL_DATASET')
 result={'version':1,'zoom':a.zoom,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tiles':{},'missing':[],'source':'Copernicus DEM GLO-90 2021 DSM','sourceResolutionMeters':90}
 # Preload via the shared resumable downloader. Immutable vendor URLs have no credentials.
 for index,(x,y) in enumerate(sorted(keys)):
  key=f'{x}/{y}';relative=f'{a.zoom}/{x}/{y}.json';path=out/relative
  if path.exists():result['tiles'][key]={'url':relative};continue
  bounds=[x/n*2*W-W,W-(y+1)/n*2*W,(x+1)/n*2*W-W,W-y/n*2*W]
  try:
   corners=[dem.lonlat(bounds[i],bounds[j]) for i in [0,2] for j in [1,3]]
   for lat in range(math.floor(min(p[1] for p in corners)),math.floor(max(p[1] for p in corners))+1):
    for lon in range(math.floor(min(p[0] for p in corners)),math.floor(max(p[0] for p in corners))+1):
     name=f'Copernicus_DSM_COG_30_{"N" if lat>=0 else "S"}{abs(lat):02d}_00_{"E" if lon>=0 else "W"}{abs(lon):03d}_00_DEM'
     fetch(f'https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif',dem.CACHE/f'cop-{lat}-{lon}.tif')
   values,names=dem.sample_grid(bounds,129)
   if any(not math.isfinite(v) or v< -12000 or v>9000 for v in values):raise RuntimeError('DEM_NODATA')
   grid={'width':129,'height':129,'boundsMercator':bounds,'elevations':[round(v,1) for v in values],'sourceResolutionMeters':90}
   path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'grid':grid,'sourceFiles':names,'dataset':'Copernicus GLO-90 2021'},separators=(',',':')),encoding='utf-8')
   result['tiles'][key]={'url':relative}
  except Exception:result['missing'].append(key)
  dem.MEM.clear()
  result['status']='PARTIAL' if result['missing'] else 'COMPLETE'
  (out/'manifest.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
  if (index+1)%20==0:print(json.dumps({'processed':index+1,'total':len(keys),'available':len(result['tiles']),'missing':len(result['missing'])}),flush=True)
 print(json.dumps({'available':len(result['tiles']),'missing':len(result['missing']),'total':len(keys)}))
if __name__=='__main__':main()
