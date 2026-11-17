#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MAP_DIR="${FLOWAD_MAP_DIR:-$HOME/Library/Flowad/maps}"
IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1
mkdir -p "$MAP_DIR"
if [ ! -s "$MAP_DIR/korea.osm.pbf" ]; then
  curl --fail --location --retry 2 https://download.geofabrik.de/asia/south-korea-latest.osm.pbf -o "$MAP_DIR/korea.osm.pbf"
fi
docker run --name flowad-roads-build --memory 10g --memory-swap 10g --cpus 4 \
  -v "$MAP_DIR:/data" "$IMAGE" sh -c '
  set -eu
  cd /data
  osrm-extract --threads 2 -p /opt/car.lua korea.osm.pbf
  osrm-partition --threads 2 korea.osrm
  osrm-customize --threads 2 korea.osrm
  printf "build_memory_peak_bytes="
  cat /sys/fs/cgroup/memory.peak
'
docker run -d --name flowad-roads-free-check --memory 512m --memory-swap 512m --cpus .1 \
  -p 127.0.0.1:18082:10000 -v "$MAP_DIR:/data:ro" \
  -v "$SCRIPT_DIR/../deploy/osrm/start.sh:/start.sh:ro" --entrypoint /bin/sh "$IMAGE" /start.sh
printf '%s\n' 'Server launched; measure routes and inspect memory.events before claiming a pass.'
