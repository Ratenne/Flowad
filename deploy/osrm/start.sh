#!/bin/sh
set -eu
printf 'Starting Korea road server on port %s\n' "${PORT:-10000}"
if [ -r /sys/fs/cgroup/memory.max ]; then
 printf 'Container memory limit: '
 cat /sys/fs/cgroup/memory.max
fi
exec osrm-routed --algorithm mld --mmap=1 --verbosity WARNING --threads 1 \
 --port "${PORT:-10000}" --max-viaroute-size 20 --max-table-size 3 \
 --max-matching-size 3 --max-trip-size 3 --max-nearest-size 1 /data/korea.osrm
