"""Read local cached official Copernicus GLO-90 COGs; all HTTP uses inherited proxy settings."""
import math,urllib.request,urllib.error,concurrent.futures
from pathlib import Path
from PIL import Image
import numpy as np
R=6378137
CACHE=Path('/workspace/scratch/debf1c22834c/terrain-cache')
MEM={}
def lonlat(x,y):return math.degrees(x/R),math.degrees(math.atan(math.sinh(y/R)))
def load_tile(key):
 if key in MEM:return MEM[key]
 lat,lon=key
 name=f'Copernicus_DSM_COG_30_{"N" if lat>=0 else "S"}{abs(lat):02d}_00_{"E" if lon>=0 else "W"}{abs(lon):03d}_00_DEM'
 path=CACHE/f'cop-{lat}-{lon}.tif'
 if not path.exists():
  url=f'https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif'
  req=urllib.request.Request(url,headers={'User-Agent':'GilGyeolPrototype/0.1 (+https://gil-gyeol-drive.o94777.chatgpt.site)'})
  with urllib.request.urlopen(req,timeout=45) as response:path.write_bytes(response.read())
 image=Image.open(path);arr=np.asarray(image,dtype=np.float32);scale=image.tag_v2[33550];tie=image.tag_v2[33922]
 MEM[key]=(arr,scale,tie,name);return MEM[key]
def sample_grid(bounds,size):
 b=bounds;positions=[lonlat(b[0]+(b[2]-b[0])*i/(size-1),b[3]-(b[3]-b[1])*j/(size-1)) for j in range(size) for i in range(size)]
 keys=sorted({(math.floor(lat),math.floor(lon)) for lon,lat in positions})
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(load_tile,keys))
 values=[]
 for lon,lat in positions:
  arr,scale,tie,_=MEM[(math.floor(lat),math.floor(lon))];ny,nx=arr.shape
  # RasterPixelIsPoint: raster nodes are located at the tie-point and scale, no half-pixel shift.
  x=max(0,min(nx-1,(lon-tie[3])/scale[0]));y=max(0,min(ny-1,(tie[4]-lat)/scale[1]));ix=min(nx-2,int(x));iy=min(ny-2,int(y));fx=x-ix;fy=y-iy
  value=(float(arr[iy,ix])*(1-fx)+float(arr[iy,ix+1])*fx)*(1-fy)+(float(arr[iy+1,ix])*(1-fx)+float(arr[iy+1,ix+1])*fx)*fy
  if not math.isfinite(value) or value < -500 or value > 9000:raise ValueError('Invalid surface elevation')
  values.append(round(value,1))
 return values,[MEM[key][3] for key in keys]
