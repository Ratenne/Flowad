# Download in a separate maintained image: OSRM's older Debian package indexes
# must not be used to install a downloader.
FROM curlimages/curl:8.12.1 AS download
WORKDIR /tmp
ARG OSM_PBF_URL=https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
RUN curl --fail --location --retry 2 "$OSM_PBF_URL" -o korea.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS map
WORKDIR /data
COPY --from=download /tmp/korea.osm.pbf /data/korea.osm.pbf
RUN osrm-extract --threads 2 -p /opt/car.lua korea.osm.pbf \
 && osrm-partition --threads 2 korea.osrm \
 && osrm-customize --threads 2 korea.osrm \
 && rm korea.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=map /data /data
EXPOSE 10000
CMD ["/bin/sh", "-c", "exec osrm-routed --algorithm mld --mmap=1 --threads 1 --port ${PORT:-10000} --max-viaroute-size 20 --max-table-size 2 --max-matching-size 2 /data/korea.osrm"]
