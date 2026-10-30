# 대한민국 도로 서버 — Render Free

2026-10-31 04:04 KST 배포 성공. 사용자가 무료 플랜 배포를 명시적으로 요청했다.

- 서비스: https://dashboard.render.com/web/srv-dbieeqec6qcc73a9dm70
- API: https://flowad-roads.onrender.com
- Git 브랜치: codex/korea-roads-free (실행 커밋 858c4ef8c90dbc531bf28b45f40d40f337a4a82e)
- Dockerfile: deploy/osrm/Dockerfile
- 플랜: Free ($0/month, 0.1 CPU, 512MB). 유료 업그레이드·디스크는 생성하지 않는다.
- 자동 배포: Off. 의도하지 않은 반복 지도 빌드를 피한다.

지도 파일은 Geofabrik의 대한민국 OSM PBF를 다운로드한다. OSRM v5.27.1의 car 프로필과 MLD 전처리로 데이터 파일을 생성하고 이미지에 포함한다. 재시작 때 지도를 다운로드·전처리하지 않는다. 실행 시 --mmap=1, 1 worker, 최대 경유지 20개를 적용한다. 요청 URL에 좌표가 들어가므로 OSRM 로그는 WARNING으로 제한한다. 부가 API(table/matching/trip)의 제한값은 이 버전의 최소 허용값인 3이며 nearest는 1이다. 2는 EngineConfig 검증에서 실패하므로 사용하지 않는다.

Render 빌드 환경에서 실제 전처리는 약 194초 걸렸다. extract의 프로세스 최대 메모리는 3,155,767,296 bytes, customize는 1,456,353,280 bytes였다. 이 값은 빌드 메모리이며 512MB 실행 성공을 의미하지 않는다. 로컬 arm64 실행 검증에서는 512MB/0.1CPU/스왑 없음 조건으로 서울·부산·제주·서울→부산·왕복 5개 도로 요청과 좌표/경유지 제한 오류 2개를 통과했다. 장거리 요청 8개(동시 4개) 후 cgroup memory.peak=301,944,832 bytes(약 288MiB), oom=0, oom_kill=0였다. 이는 로컬 측정이며 Render 실측과 구분한다.

Render 실제 검증: 서울 9.93km, 부산 8.63km, 제주 49.50km, 서울→부산 392.63km, 왕복 20.95km(2구간) 응답을 확인했다. 첫 서울 요청은 10.712초(기동 대기 포함), 이후 0.482–1.299초였다. 잘못된 위도와 경유지 21개 요청은 HTTP 400으로 거부됐다. 원본 요약: artifacts/roads/render-probe.json. Render UI에서 Free 및 Your service is live를 확인했다.

로컬 재현: `sh scripts/validate-roads-free.sh`. 지도를 $HOME/Library/Flowad/maps에 보관하고, 빌드는 10GB/4CPU 한도, 실행 테스트는 512MB/0.1CPU·swap 없음으로 수행한다. 결과를 확인한 후 테스트 컨테이너는 중지한다. Docker 또는 Colima가 필요하다.

API 검증: `python3 scripts/smoke-roads.py https://flowad-roads.onrender.com --output artifacts/roads/render-probe.json`.

검증 좌표는 서울·부산·제주의 공개 시내 기준점이며 사용자 현재 위치를 쓰지 않는다. 도로 정보는 © OpenStreetMap contributors, ODbL. 실시간 교통·도로 통제·사유지 진입은 보증하지 않는다.

Render Free는 15분 비활동 후 절전되며 첫 요청에 약 1분 걸릴 수 있다. 워크스페이스의 무료 실행 시간 750시간을 다른 Free 서비스와 공유한다. 상시 가용성은 보장되지 않는다. 무료 한도 초과 시 유료 전환 없이 중단한다.

근거: https://render.com/docs/free / https://github.com/Project-OSRM/osrm-backend / https://download.geofabrik.de/asia/south-korea.html

현재 변경은 별도 도로 서버 배포다. 기존 Flowad 서비스의 Git 브랜치와 환경변수는 변경하지 않았다. 앱 연결 시 ROAD_ROUTING_URL=https://flowad-roads.onrender.com 및 OsrmRoadProvider가 포함된 백엔드 배포가 필요하다.
