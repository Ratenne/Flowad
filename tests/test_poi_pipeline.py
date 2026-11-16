import json, os, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from poi_pipeline import Store, ingest_osm, ingest_tour, export
from types import SimpleNamespace

class Pipeline(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name);self.store=Store(self.path/'test.sqlite');self.store.boundary=[]
 def tearDown(self):self.store.db.close();self.temp.cleanup()
 def add(self,id,name='테스트 명소',lon=127,lat=37.5):
  self.store.put(id,name,{'type':'Point','coordinates':[lon,lat]},'viewpoint',{},'2026-01-01')
 def test_snapshot_duplicates_validation_and_failed_activation(self):
  self.store.begin('OSM','one','2026-01-01');self.add('node:1');self.add('node:2');self.add('node:3','');self.add('node:4',lon=0)
  self.assertEqual(self.store.finish()['total'],2)
  self.assertEqual(self.store.db.execute('SELECT count(*) FROM pois WHERE duplicate_of IS NOT NULL').fetchone()[0],1)
  self.store.begin('OSM','failed','2026-01-02');self.add('node:9')
  self.assertEqual(self.store.stats()['total'],2)
 def test_updates_and_deletes(self):
  self.store.begin('OSM','one','2026-01-01');self.add('node:1');self.add('node:2','다른 명소');self.store.finish()
  self.store.begin('OSM','two','2026-01-02');self.add('node:1','바뀐 명소',lon=127.1);self.store.finish()
  job=self.store.db.execute("SELECT * FROM poi_sync_jobs WHERE id='osm-two'").fetchone()
  self.assertEqual(job['deleted'],1);self.assertEqual(job['updated'],1);self.assertEqual(self.store.stats()['total'],1)
  self.assertEqual(self.store.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
 def test_osm_nodes_ways_and_area_relations(self):
  xml='''<osm version="0.6"><node id="1" lat="37.5" lon="127" version="1"><tag k="name" v="전망대"/><tag k="tourism" v="viewpoint"/></node><node id="2" lat="37.501" lon="127.001" version="1"/><node id="3" lat="37.502" lon="127" version="1"/><way id="10" version="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="natural" v="water"/><tag k="name" v="호수"/></way><relation id="20" version="1"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/><tag k="leisure" v="nature_reserve"/><tag k="name" v="자연보호구역"/></relation></osm>'''
  (self.path/'input.osm').write_text(xml,encoding='utf-8');(self.path/'country.poly').write_text('country\n1\n124 32\n132 32\n132 39\n124 39\n124 32\nEND\nEND\n')
  ingest_osm(SimpleNamespace(pbf=self.path/'input.osm',boundary=self.path/'country.poly'),self.store)
  ids={r[0] for r in self.store.db.execute('SELECT id FROM pois')}
  self.assertTrue({'osm:node:1','osm:way:10','osm:relation:20'}<=ids)
 def test_export_and_blocked_credentials(self):
  self.store.begin('OSM','one','2026-01-01');self.add('node:1');self.store.finish();export(self.store,self.path/'sql')
  self.assertTrue((self.path/'sql/manifest.json').exists());self.assertTrue((self.path/'sql/activate.sql').exists())
  before=os.environ.pop('TOUR_API_KEY',None)
  try:self.assertEqual(ingest_tour(SimpleNamespace(),self.store)['status'],'BLOCKED_MISSING_CREDENTIAL')
  finally:
   if before is not None:os.environ['TOUR_API_KEY']=before

if __name__=='__main__':unittest.main()
