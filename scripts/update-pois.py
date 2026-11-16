"""Fetch a versioned provider snapshot, then project insert/change/delete differences.
No production writes. Follow with validation/export and the explicit D1 loader.
"""
import argparse,datetime,hashlib,json,os,subprocess,sys,urllib.request
from pathlib import Path
from poi_pipeline import fetch,Store
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser();p.add_argument('provider',choices=['osm','tour']);p.add_argument('--db',default='data/generated/pois.sqlite');p.add_argument('--raw',default='data/raw');p.add_argument('--force',action='store_true');args=p.parse_args()
 raw=Path(args.raw);raw.mkdir(parents=True,exist_ok=True)
 boundary=fetch('https://download.geofabrik.de/asia/south-korea.poly',raw/'south-korea.poly')
 command=[sys.executable,str(ROOT/'scripts/poi_pipeline.py'),args.provider,'--db',args.db,'--boundary',str(boundary)]
 if args.provider=='osm':
  url='https://download.geofabrik.de/asia/south-korea-latest.osm.pbf'
  with urllib.request.urlopen(url+'.md5',timeout=30) as response:expected=response.read(1024).decode().split()[0]
  if len(expected)!=32 or any(c not in '0123456789abcdef' for c in expected.lower()):raise RuntimeError('INVALID_PROVIDER_CHECKSUM')
  source=fetch(url,raw/f'south-korea-{expected}.osm.pbf')
  with source.open('rb') as stream:actual=hashlib.file_digest(stream,'md5').hexdigest()
  if actual!=expected:raise RuntimeError('SOURCE_CHANGED_OR_CORRUPT_NOT_IMPORTED')
  with source.open('rb') as stream:sha=hashlib.file_digest(stream,'sha256').hexdigest()
  db=Store(args.db);row=db.db.execute("SELECT active_dataset FROM poi_provider_state WHERE provider='OSM'").fetchone();db.db.close()
  if not args.force and row and row[0]=='osm-'+sha[:24]:print(json.dumps({'status':'UNCHANGED','provider':'OSM','sha256':sha}));return
  command+=['--pbf',str(source)]
 else:
  # A fresh cache directory per synchronization prevents an old successful page
  # from suppressing provider changes or deletions. An interrupted run can resume
  # by passing its cache to poi_pipeline.py tour directly.
  cache=raw/'tour'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
  command+=['--cache',str(cache)]
 subprocess.run(command,check=True)
if __name__=='__main__':main()
