"""Offline nationwide public-data ingestion. Never contacts Flowad or Tesla.
Python 3.11+, osmium. SQLite staging; resumable deterministic snapshots; D1 SQL export.
"""
import argparse, datetime as dt, gzip, hashlib, json, math, os, re, sqlite3, time, unicodedata
import urllib.request, urllib.parse, xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ATTR = {'OSM':'© OpenStreetMap contributors, ODbL 1.0', 'TOURAPI':'한국관광공사 TourAPI, 공공데이터포털 15101578'}
TAGS = {'tourism':{'viewpoint','attraction','picnic_site'},'natural':{'peak','beach','water'},'waterway':{'waterfall'},'leisure':{'nature_reserve','park'}}
def stamp(): return dt.datetime.now(dt.timezone.utc).isoformat()
def normalized(s): return re.sub(r'[^\w]', '', unicodedata.normalize('NFKC',s).casefold())
def km(a,b,c,d):
    r=math.pi/180; v=math.sin((c-a)*r/2)**2+math.cos(a*r)*math.cos(c*r)*math.sin((d-b)*r/2)**2
    return 12742*math.asin(math.sqrt(min(1,v)))
def quoted(x): return 'NULL' if x is None else str(x) if isinstance(x,(int,float)) else "'"+str(x).replace("'","''")+"'"
def fetch(url,path):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists(): return path
    part=path.with_suffix(path.suffix+'.part')
    for retry in range(5):
        try:
            offset=part.stat().st_size if part.exists() else 0
            req=urllib.request.Request(url,headers={'User-Agent':'Flowad-Public-POI-Batch/1.0',**({'Range':f'bytes={offset}-'} if offset else {})})
            with urllib.request.urlopen(req,timeout=90) as r:
                mode='ab' if offset and r.status==206 else 'wb'
                with part.open(mode) as out:
                    while chunk:=r.read(1024*1024): out.write(chunk)
            part.replace(path); return path
        except Exception:
            if retry==4: raise RuntimeError('DATA_DOWNLOAD_FAILED') from None
            time.sleep(2**retry)
def poly(path):
    rings=[]; ring=[]
    for line in Path(path).read_text().splitlines()[1:]:
        fields=line.split()
        if len(fields)==2:
            try: ring.append((float(fields[0]),float(fields[1])))
            except ValueError: pass
        elif line.strip()=='END' and ring: rings.append(ring); ring=[]
    if not rings: raise ValueError('INVALID_COUNTRY_BOUNDARY')
    return rings
def inside_ring(x,y,ring):
    inside=False
    for (a,b),(c,d) in zip(ring,ring[1:]+ring[:1]):
        if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a: inside=not inside
    return inside
def inside_geometry(x,y,g):
    polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    return any(inside_ring(x,y,p[0]) and not any(inside_ring(x,y,h) for h in p[1:]) for p in polys)
def points(g):
    if g['type']=='GeometryCollection':
        for child in g['geometries']: yield from points(child)
        return
    def walk(v):
        if len(v)>=2 and isinstance(v[0],(int,float)): yield v[:2]
        else:
            for child in v: yield from walk(child)
    yield from walk(g['coordinates'])
def representative(g):
    # An existing geometry vertex: no invented entrance or centroid inside an inaccessible lake.
    iterator=iter(points(g)); first=next(iterator,None)
    if first is None: raise ValueError('EMPTY_GEOMETRY')
    if not all(math.isfinite(v) for v in first): raise ValueError('INVALID_GEOMETRY')
    return first
def kind(tags): return next((value for key,values in TAGS.items() if (value:=tags.get(key)) in values),None)
def scenery(category): return 'coast' if category=='beach' else 'forest' if category in {'nature_reserve','park','waterfall'} else 'open'
def access(tags):
    if any(tags.get(k) in {'no','private'} for k in ['access','motor_vehicle','motorcar','vehicle']): return 'NO_CAR_ACCESS'
    return 'POSSIBLE_ACCESS' if tags.get('parking') in {'yes','surface'} or tags.get('amenity')=='parking' else 'UNVERIFIED_ACCESS'

class Store:
    def __init__(self,path):
        Path(path).parent.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(path); self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL'); self.db.execute('PRAGMA foreign_keys=ON')
        if not self.db.execute("SELECT 1 FROM sqlite_master WHERE name='pois'").fetchone():
            self.db.executescript((ROOT/'workers/migrations/0002_pois.sql').read_text())
        self.db.executescript('CREATE TABLE IF NOT EXISTS raw_geometry(provider TEXT,source_id TEXT,geometry_json TEXT,PRIMARY KEY(provider,source_id)); CREATE TABLE IF NOT EXISTS admin_regions(name TEXT PRIMARY KEY,geometry_json TEXT); CREATE TABLE IF NOT EXISTS relation_members(id TEXT PRIMARY KEY,tags TEXT,members TEXT,updated_at TEXT);')
        self.db.executescript('CREATE TABLE IF NOT EXISTS road_candidates(id INTEGER PRIMARY KEY,coordinates TEXT NOT NULL,kind TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS road_spatial USING rtree(id,min_lat,max_lat,min_lon,max_lon);')
        self.regions=[]; self.processed=0; self.rejected=0
    def begin(self,provider,fingerprint,source_updated):
        self.provider=provider; self.dataset=provider.lower()+'-'+fingerprint[:24]; self.updated=source_updated; self.at=stamp()
        self.db.execute('INSERT OR IGNORE INTO poi_datasets VALUES(?,?,?,?,?,?)',(self.dataset,provider,self.at,source_updated,ATTR[provider],'STAGING'))
        self.db.execute('INSERT OR IGNORE INTO poi_sync_jobs(id,provider,started_at,status) VALUES(?,?,?,?)',(self.dataset,provider,self.at,'RUNNING')); self.db.commit()
    def put(self,sid,name,g,category,tags,updated,address=None,region=None,description=None):
        self.processed+=1
        try: lon,lat=representative(g)
        except (ValueError,TypeError,KeyError): self.rejected+=1; return
        if not name or not normalized(name) or not(32<=lat<=39.5 and 124<=lon<=132) or (self.boundary and not any(inside_ring(lon,lat,r) for r in self.boundary)):
            self.rejected+=1; return
        pid=self.provider.lower()+':'+sid; state=access(tags)
        geom=json.dumps(g,separators=(',',':'),ensure_ascii=False)
        attributes={k:v for k,v in tags.items() if k not in {'description','note','fixme'}}
        attributes['geometry_sha256']=hashlib.sha256(geom.encode()).hexdigest()
        attributes['representative']='GEOMETRY_VERTEX_NOT_ENTRANCE'
        self.db.execute('INSERT OR REPLACE INTO raw_geometry VALUES(?,?,?)',(self.provider,sid,geom))
        self.db.execute('INSERT INTO pois VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dataset_id,id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,latitude=excluded.latitude,longitude=excluded.longitude,category=excluded.category,scenery=excluded.scenery,address=excluded.address,region=excluded.region,description=excluded.description,quality=excluded.quality,access_status=excluded.access_status,updated_at=excluded.updated_at',
            (self.dataset,pid,self.provider,sid,name.strip()[:500],normalized(name),lat,lon,category,scenery(category),address,region,description,'NAMED_COORDINATE',state,None,self.at,updated,None))
        self.db.execute('INSERT OR REPLACE INTO poi_sources VALUES(?,?,?,?,?,?,?)',(self.dataset,pid,self.provider,sid,json.dumps(attributes,ensure_ascii=False),updated,ATTR[self.provider]))
        # POI representatives remain unverified. Parking-tag candidates are still not verified entrances.
        self.db.execute('INSERT OR REPLACE INTO poi_access_points VALUES(?,?,?,?,?,?,?,?)',(self.dataset,pid,'POI_REPRESENTATIVE',lat,lon,state,'SOURCE_TAGS_NOT_FIELD_VERIFIED',None))
        if self.processed%2000==0:
            self.db.execute('UPDATE poi_sync_jobs SET processed=?,rejected=?,checkpoint=? WHERE id=?',(self.processed,self.rejected,sid,self.dataset));self.db.commit()
    def finish(self):
        regions=[(r[0],json.loads(r[1])) for r in self.db.execute('SELECT * FROM admin_regions')]
        cursor=self.db.execute('SELECT id,latitude,longitude FROM pois WHERE dataset_id=? AND region IS NULL',(self.dataset,))
        for row in cursor:
            region=next((name for name,g in regions if inside_geometry(row[2],row[1],g)), 'UNCLASSIFIED')
            self.db.execute('UPDATE pois SET region=? WHERE dataset_id=? AND id=?',(region,self.dataset,row[0]))
        for row in self.db.execute("SELECT id,latitude,longitude FROM pois WHERE dataset_id=? AND access_status!='NO_CAR_ACCESS'",(self.dataset,)):
            pid,lat,lon=row;best=None
            for road in self.db.execute('SELECT c.coordinates,c.kind FROM road_spatial r JOIN road_candidates c ON c.id=r.id WHERE r.min_lat<? AND r.max_lat>? AND r.min_lon<? AND r.max_lon>? LIMIT 100',(lat+.005,lat-.005,lon+.006,lon-.006)):
                coords=json.loads(road[0]); candidates=[]
                for a,b in zip(coords,coords[1:] or coords):
                    sx=math.cos(lat*math.pi/180);ax=(a[0]-lon)*sx;ay=a[1]-lat;dx=(b[0]-a[0])*sx;dy=b[1]-a[1];den=dx*dx+dy*dy
                    t=max(0,min(1,-(ax*dx+ay*dy)/den)) if den else 0
                    x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t;candidates.append((km(lat,lon,y,x),y,x))
                if not candidates:continue
                d,y,x=min(candidates)
                if d>(.5 if road[1]=='PARKING_CANDIDATE' else .3):continue
                rank=d-(.05 if road[1]=='PARKING_CANDIDATE' else 0)
                if best is None or rank<best[0]:best=(rank,y,x,road[1])
            if best:
                _,y,x,k=best
                self.db.execute('INSERT OR REPLACE INTO poi_access_points VALUES(?,?,?,?,?,?,?,?)',(self.dataset,pid,k,y,x,'POSSIBLE_ACCESS','OSM_ROAD_OR_PARKING_TAGS_NOT_FIELD_VERIFIED',None))
                self.db.execute('UPDATE pois SET access_status=? WHERE dataset_id=? AND id=?',('POSSIBLE_ACCESS',self.dataset,pid))
        # Conservative exact-name + <=80m duplicate detection. Retain all source records for audit.
        for row in self.db.execute('SELECT rowid,* FROM pois WHERE dataset_id=? ORDER BY id',(self.dataset,)):
            matches=self.db.execute('SELECT id,latitude,longitude FROM pois WHERE dataset_id=? AND normalized_name=? AND id<? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? AND duplicate_of IS NULL',(self.dataset,row['normalized_name'],row['id'],row['latitude']-.001,row['latitude']+.001,row['longitude']-.001,row['longitude']+.001))
            duplicate=next((r[0] for r in matches if km(row['latitude'],row['longitude'],r[1],r[2])<.08),None)
            if duplicate:self.db.execute('UPDATE pois SET duplicate_of=? WHERE dataset_id=? AND id=?',(duplicate,self.dataset,row['id']))
        previous=self.db.execute('SELECT active_dataset FROM poi_provider_state WHERE provider=?',(self.provider,)).fetchone()
        inserted=updated=deleted=0
        if previous and previous[0]!=self.dataset:
            old=previous[0]
            inserted=self.db.execute('SELECT count(*) FROM pois n WHERE dataset_id=? AND NOT EXISTS(SELECT 1 FROM pois o WHERE o.dataset_id=? AND o.id=n.id)',(self.dataset,old)).fetchone()[0]
            deleted=self.db.execute('SELECT count(*) FROM pois o WHERE dataset_id=? AND NOT EXISTS(SELECT 1 FROM pois n WHERE n.dataset_id=? AND n.id=o.id)',(old,self.dataset)).fetchone()[0]
            updated=self.db.execute('SELECT count(*) FROM pois n JOIN pois o ON o.id=n.id AND o.dataset_id=? WHERE n.dataset_id=? AND (n.latitude!=o.latitude OR n.longitude!=o.longitude OR n.name!=o.name OR n.updated_at!=o.updated_at OR n.access_status!=o.access_status)',(old,self.dataset)).fetchone()[0]
        elif not previous: inserted=self.db.execute('SELECT count(*) FROM pois WHERE dataset_id=?',(self.dataset,)).fetchone()[0]
        count=self.db.execute('SELECT count(*) FROM pois WHERE dataset_id=?',(self.dataset,)).fetchone()[0]
        if not count: raise RuntimeError('EMPTY_SNAPSHOT_NOT_ACTIVATED')
        self.db.execute('UPDATE poi_datasets SET status=? WHERE id=?',('COMPLETE',self.dataset))
        self.db.execute('INSERT OR REPLACE INTO poi_provider_state VALUES(?,?)',(self.provider,self.dataset))
        self.db.execute('UPDATE poi_sync_jobs SET status=?,finished_at=?,processed=?,inserted=?,updated=?,deleted=?,rejected=?,checkpoint=? WHERE id=?',('COMPLETE',stamp(),self.processed,inserted,updated,deleted,self.rejected,'COMPLETE',self.dataset));self.db.commit()
        return self.stats()
    def stats(self):
        return {'total':self.db.execute('SELECT count(*) FROM pois p JOIN poi_provider_state s ON s.active_dataset=p.dataset_id').fetchone()[0], 'regions':[dict(r) for r in self.db.execute('SELECT region,count(*) count FROM pois p JOIN poi_provider_state s ON s.active_dataset=p.dataset_id GROUP BY region')], 'jobs':[dict(r) for r in self.db.execute('SELECT * FROM poi_sync_jobs')]}

def ingest_osm(args,store):
    import osmium
    source=Path(args.pbf); digest=hashlib.file_digest(source.open('rb'),'sha256').hexdigest()
    reader=osmium.io.Reader(str(source)); header=reader.header(); updated=header.get('osmosis_replication_timestamp') or dt.datetime.fromtimestamp(source.stat().st_mtime,dt.timezone.utc).isoformat();reader.close()
    store.begin('OSM',digest,updated); store.boundary=poly(args.boundary)
    store.db.execute('DELETE FROM relation_members');store.db.execute('DELETE FROM admin_regions');store.db.execute('DELETE FROM road_candidates');store.db.execute('DELETE FROM road_spatial')
    factory=osmium.geom.GeoJSONFactory()
    class Handler(osmium.SimpleHandler):
        def node(self,n):
            t=dict(n.tags); c=kind(t)
            if t.get('amenity')=='parking' and access(t)!='NO_CAR_ACCESS' and n.location.valid():
                key=-n.id;store.db.execute('INSERT OR REPLACE INTO road_candidates VALUES(?,?,?)',(key,json.dumps([[n.location.lon,n.location.lat]]),'PARKING_CANDIDATE'));store.db.execute('INSERT OR REPLACE INTO road_spatial VALUES(?,?,?,?,?)',(key,n.location.lat,n.location.lat,n.location.lon,n.location.lon))
            if c and n.location.valid(): store.put('node:'+str(n.id),t.get('name:ko') or t.get('name'),{'type':'Point','coordinates':[n.location.lon,n.location.lat]},c,t,str(n.timestamp))
        def way(self,w):
            t=dict(w.tags); c=kind(t)
            car=t.get('highway') in {'motorway','trunk','primary','secondary','tertiary','unclassified','residential','service','living_street','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'}
            parking=t.get('amenity')=='parking'
            if (car or parking) and access(t)!='NO_CAR_ACCESS':
                try:
                    coords=json.loads(factory.create_linestring(w))['coordinates'];xs=[p[0] for p in coords];ys=[p[1] for p in coords]
                    store.db.execute('INSERT OR REPLACE INTO road_candidates VALUES(?,?,?)',(w.id,json.dumps(coords),'PARKING_CANDIDATE' if parking else 'ROAD_CANDIDATE'))
                    store.db.execute('INSERT OR REPLACE INTO road_spatial VALUES(?,?,?,?,?)',(w.id,min(ys),max(ys),min(xs),max(xs)))
                except Exception:pass
            if c:
                try:g=json.loads(factory.create_linestring(w))
                except Exception:store.rejected+=1;return
                store.put('way:'+str(w.id),t.get('name:ko') or t.get('name'),g,c,t,str(w.timestamp))
        def area(self,a):
            t=dict(a.tags); c=kind(t)
            if not c and not(t.get('boundary')=='administrative' and t.get('admin_level')=='4'):return
            try:g=json.loads(factory.create_multipolygon(a))
            except Exception:store.rejected+=1;return
            if not c:
                name=t.get('name:ko') or t.get('name')
                if name:store.db.execute('INSERT OR REPLACE INTO admin_regions VALUES(?,?)',(name,json.dumps(g)))
            else:store.put(('way:' if a.from_way() else 'relation:')+str(a.orig_id()),t.get('name:ko') or t.get('name'),g,c,t,str(a.timestamp))
        def relation(self,r):
            t=dict(r.tags)
            if kind(t) and t.get('type') not in {'multipolygon','boundary'}:
                store.db.execute('INSERT OR REPLACE INTO relation_members VALUES(?,?,?,?)',(str(r.id),json.dumps(t),json.dumps([(m.type,m.ref) for m in r.members]),str(r.timestamp)))
    Handler().apply_file(str(source),locations=True,idx='flex_mem')
    # Non-area relations need referenced member geometry, including non-POI members.
    relations=list(store.db.execute('SELECT * FROM relation_members'))
    if relations:
        wanted={tuple(m) for r in relations for m in json.loads(r['members'])}; geometry={}
        class Members(osmium.SimpleHandler):
            def node(self,n):
                if ('n',n.id) in wanted and n.location.valid():geometry[('n',n.id)]={'type':'Point','coordinates':[n.location.lon,n.location.lat]}
            def way(self,w):
                if ('w',w.id) in wanted:
                    try:geometry[('w',w.id)]=json.loads(factory.create_linestring(w))
                    except Exception:pass
        Members().apply_file(str(source),locations=True,idx='flex_mem')
        for r in relations:
            refs=[tuple(m) for m in json.loads(r['members'])]; parts=[geometry[m] for m in refs if m in geometry]
            if len(parts)!=len(refs):store.rejected+=1;continue
            t=json.loads(r['tags']);store.put('relation:'+r['id'],t.get('name:ko') or t.get('name'),{'type':'GeometryCollection','geometries':parts},kind(t),t,r['updated_at'])
    return store.finish()

def ingest_tour(args,store):
    key=os.environ.get('TOUR_API_KEY')
    if not key:return {'status':'BLOCKED_MISSING_CREDENTIAL','credential':'TOUR_API_KEY'}
    # Freeze raw pages before projection; retry/resume from disk, never log the credential URL.
    cache=Path(args.cache);cache.mkdir(parents=True,exist_ok=True); all_files=[]
    for content_type in [12,14,28]:
        page=1
        while True:
            path=cache/f'{content_type}-{page}.json'
            if not path.exists():
                query=urllib.parse.urlencode({'serviceKey':urllib.parse.unquote(key),'MobileOS':'ETC','MobileApp':'Flowad','_type':'json','numOfRows':100,'pageNo':page,'contentTypeId':content_type,'arrange':'C'})
                fetch('https://apis.data.go.kr/B551011/KorService2/areaBasedList2?'+query,path);time.sleep(.3)
            data=json.loads(path.read_text());response=data['response']
            if response['header']['resultCode'] not in {'0000','00'}:raise RuntimeError('TOURAPI_PROVIDER_REJECTED')
            body=response['body'];all_files.append(path)
            if page*100>=int(body['totalCount']):break
            page+=1
    fingerprint=hashlib.sha256(b''.join(hashlib.sha256(p.read_bytes()).digest() for p in all_files)).hexdigest()
    store.begin('TOURAPI',fingerprint,stamp());store.boundary=poly(args.boundary)
    for path in all_files:
        body=json.loads(path.read_text())['response']['body'];items=body.get('items') or {};items=items.get('item',[]) if isinstance(items,dict) else []
        for item in items:
            try: g={'type':'Point','coordinates':[float(item['mapx']),float(item['mapy'])]}
            except (KeyError,ValueError,TypeError):store.rejected+=1;continue
            store.put(str(item['contentid']),item.get('title'),g,'attraction',item,item.get('modifiedtime') or store.updated,item.get('addr1'),str(item.get('areacode') or 'UNCLASSIFIED'),item.get('overview'))
    return store.finish()

def export(store,directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True);index=0;size=0;out=None; hashes={}
    def write(sql):
        nonlocal index,size,out
        encoded=len(sql.encode())
        if encoded>90000:raise RuntimeError('ROW_EXCEEDS_D1_SQL_LIMIT')
        if out is None or size+encoded>80000:
            if out:out.close()
            index+=1;out=(directory/f'{index:06}.sql').open('w',encoding='utf-8');size=0
        out.write(sql+'\n');size+=encoded
    active=[r[0] for r in store.db.execute('SELECT active_dataset FROM poi_provider_state')]
    for table in ['poi_datasets','pois','poi_sources','poi_access_points','poi_sync_jobs']:
        for dataset in active:
            column='id' if table in {'poi_datasets','poi_sync_jobs'} else 'dataset_id'
            for row in store.db.execute(f'SELECT * FROM {table} WHERE {column}=?',(dataset,)):
                names=','.join(row.keys());write(f"INSERT OR IGNORE INTO {table} ({names}) VALUES ({','.join(quoted(v) for v in row)});")
    if out:out.close()
    # Final single activation file runs only after count/integrity verification.
    activation=[]
    for row in store.db.execute('SELECT * FROM poi_provider_state'):activation.append(f"INSERT OR REPLACE INTO poi_provider_state VALUES({quoted(row[0])},{quoted(row[1])});")
    (directory/'activate.sql').write_text('\n'.join(activation),encoding='utf-8')
    for path in sorted(directory.glob('[0-9]*.sql')):hashes[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
    (directory/'manifest.json').write_text(json.dumps({'files':hashes,'stats':store.stats(),'datasets':active},ensure_ascii=False,indent=2),encoding='utf-8')
    return {'files':len(hashes),'datasets':active}

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['fetch-osm','osm','tour','stats','export','validate']);p.add_argument('--db',default='data/generated/pois.sqlite');p.add_argument('--pbf',default='data/raw/south-korea-latest.osm.pbf');p.add_argument('--boundary',default='data/raw/south-korea.poly');p.add_argument('--cache',default='data/raw/tour');p.add_argument('--output',default='data/generated/d1');args=p.parse_args()
    if args.command=='fetch-osm':
        fetch('https://download.geofabrik.de/asia/south-korea.poly',args.boundary);fetch('https://download.geofabrik.de/asia/south-korea-latest.osm.pbf',args.pbf);print(json.dumps({'status':'DOWNLOADED','bytes':Path(args.pbf).stat().st_size}));return
    store=Store(args.db);store.boundary=[]
    if args.command=='osm':result=ingest_osm(args,store)
    elif args.command=='tour':result=ingest_tour(args,store)
    elif args.command=='export':result=export(store,args.output)
    elif args.command=='validate':
        result={'integrity':store.db.execute('PRAGMA integrity_check').fetchone()[0],'foreignKeys':[list(r) for r in store.db.execute('PRAGMA foreign_key_check')],**store.stats()}
    else:result=store.stats()
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
