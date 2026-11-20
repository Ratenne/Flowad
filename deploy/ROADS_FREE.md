# 대한민국 도로 서버 — Render Free

2026-10-31 04:04 KST 배포 성공. 사용자가 무료 플랜 배포를 명시적으로 요청했다.

- 서비스: https://dashboard.render.com/web/srv-dbieeqec6qcc73a9dm70
- API: https://flowad-roads.onrender.com
- Git 브랜치: codex/korea-roads-free (실행 커밋 858c4ef8c90dbc531bf28b45f40d40f337a4a82e)
- Dockerfile: deploy/osrm/Dockerfile
- 플랜: Free ($0/month, 0.1 CPU, 512MB). 유료 업그레이드·디스크는 생성하지 않는다.
- 자동 배포: Off. 의도하지 않은 반복 지도 빌드를 피한다.

지도 파일은 Geofabrik의 대한민국 OSM PBF를 다운로드한다. OSRM v5.27.1의 car 프로필과 MLD 전처리로 데이터 파일을 생성하고 이미지에 포함한다. 재시작 때 지도를 다운로드·전처리하지 않는다. 실행 시 --mmap=1, 1 worker, 최대 경유지 20개를 적용한다. 요청 URL에 좌표가 들어가므로 OSRM 로그는 WARNING으로 제한한다. 전국 동적 후보 20개와 출발·복귀를 처리하도록 Table 제한은 32다. matching/trip의 제한값은 이 버전의 최소 허용값인 3이며 nearest는 1이다. 2는 EngineConfig 검증에서 실패하므로 사용하지 않는다.

Render 빌드 환경에서 실제 전처리는 약 194초 걸렸다. extract의 프로세스 최대 메모리는 3,155,767,296 bytes, customize는 1,456,353,280 bytes였다. 이 값은 빌드 메모리이며 512MB 실행 성공을 의미하지 않는다. 로컬 arm64 실행 검증에서는 512MB/0.1CPU/스왑 없음 조건으로 서울·부산·제주·서울→부산·왕복 5개 도로 요청과 좌표/경유지 제한 오류 2개를 통과했다. 장거리 요청 8개(동시 4개) 후 cgroup memory.peak=301,944,832 bytes(약 288MiB), oom=0, oom_kill=0였다. 이는 로컬 측정이며 Render 실측과 구분한다.

Render 실제 검증: 서울 9.93km, 부산 8.63km, 제주 49.50km, 서울→부산 392.63km, 왕복 20.95km(2구간) 응답을 확인했다. 첫 서울 요청은 10.712초(기동 대기 포함), 이후 0.482–1.299초였다. 잘못된 위도와 경유지 21개 요청은 HTTP 400으로 거부됐다. 원본 요약 `artifacts/roads/render-probe.json`은 로컬 실행 산출물로 Git에서 제외한다. Render UI에서 Free 및 Your service is live를 확인했다.

로컬 재현: `sh scripts/validate-roads-free.sh`. 지도를 $HOME/Library/Flowad/maps에 보관하고, 빌드는 10GB/4CPU 한도, 실행 테스트는 512MB/0.1CPU·swap 없음으로 수행한다. 결과를 확인한 후 테스트 컨테이너는 중지한다. Docker 또는 Colima가 필요하다.

API 검증: `python3 scripts/smoke-roads.py https://flowad-roads.onrender.com --output artifacts/roads/render-probe.json`.

검증 좌표는 서울·부산·제주의 공개 시내 기준점이며 사용자 현재 위치를 쓰지 않는다. 도로 정보는 © OpenStreetMap contributors, ODbL. 실시간 교통·도로 통제·사유지 진입은 보증하지 않는다.

Render Free는 15분 비활동 후 절전되며 첫 요청에 약 1분 걸릴 수 있다. 워크스페이스의 무료 실행 시간 750시간을 다른 Free 서비스와 공유한다. 상시 가용성은 보장되지 않는다. 무료 한도 초과 시 유료 전환 없이 중단한다.

근거: https://render.com/docs/free / https://github.com/Project-OSRM/osrm-backend / https://download.geofabrik.de/asia/south-korea.html

현재 변경은 별도 도로 서버 배포다. 기존 Flowad 서비스의 Git 브랜치와 환경변수는 변경하지 않았다. 앱 연결 시 ROAD_ROUTING_URL=https://flowad-roads.onrender.com 및 OsrmRoadProvider가 포함된 백엔드 배포가 필요하다.

## 2026-11-20 운영 조사

- 운영 Worker의 도로 호스트는 `https://flowad-roads.ravirgo.com`이다. Render 서비스의 공개 주소도 계속 제공된다. Cloudflare의 09:00~11:00 KST 집계에는 커스텀 도메인 요청 26건과 원본에서 전달된 429 3건이 잡혔다. 10:44:41과 10:45:55의 `/route`는 원본과 에지 양쪽에서 429였다. 10:46:19에는 원본 상태 없이 499, 10:47:32와 10:47:59에는 각각 OSRM 400과 200이 관측됐다. 이 지표는 커스텀 도메인 통과분이며 Render의 전체 인바운드 집계와 다르다.
- 현재 설정의 0.1 CPU·512MB 한도 중 메모리는 OSRM 기동 로그의 536870912 bytes와 일치한다. 288MiB 최대 메모리는 위의 과거 로컬 제약 테스트 값이다. 장애 시점의 CPU·메모리 사용량, OOM 여부 및 원본의 전체 요청량은 확인하지 못했다.
- 12:20:32 KST의 Render 공개 호스트 `/robots.txt`는 절전 상태의 `Disallow: /`를 응답했다. 후속 공개 기준점 단일 Route는 33.5초 후 HTTP 200과 `Ok`를 반환했다. 이는 처음 한 요청의 총 대기 시간이며 OSRM 프로세스 자체의 기동 시간과 구분한다. 현재 Worker의 Route 상위 호출 제한 25초보다 길었다.
- OSRM v5.27.1 HTTP 서버는 200·400·500을 구현하며 컨테이너가 OSRM을 직접 실행한다. 따라서 관측된 원본 429는 Render 진입 계층으로 귀속된다. Render는 무료 인바운드 요청 한도가 더 낮다고 명시한다. 정확한 한도와 해당 이벤트를 차단한 내부 규칙은 공개 정보와 현재 로그로 확인할 수 없다. HTTP 요청 로그는 Pro 워크스페이스 이상에서 제공된다. [Render 429 안내](https://render.com/docs/troubleshooting-deploys#429-too-many-requests) · [Render 무료 플랜](https://render.com/docs/free) · [OSRM HTTP 상태 소스](https://github.com/Project-OSRM/osrm-backend/blob/v5.27.1/include/server/http/reply.hpp)

무료 인스턴스는 장애 시 수동 재검증을 허용하는 시범 운영에 사용할 수 있다. 상시 선택 코스 검증은 절전과 인바운드 제한 때문에 보장할 수 없다. 운영 후보 중 기존 주소·데이터·배포를 그대로 유지할 수 있는 Render 1 CPU·2GB($25/월)를 우선 검토한다. $7/월 플랜은 0.5 CPU와 512MB로 절전을 없애지만 메모리 한도가 같다. Render 유료 전환 후에도 플랫폼 제한, 동시 Route 처리량과 자원 여유를 측정해야 한다. [Render 컴퓨트 사양](https://render.com/docs/compute-plans) · [Render 요금](https://render.com/pricing?trk=public_profile__reactions-text)

OSRM을 서울 Lightsail로 옮기는 경우 공개 IPv4 리눅스 2 vCPU·2GB·60GB는 $12/월, 2 vCPU·4GB·80GB는 $24/월이다. 현행 MLD 이미지의 실행은 2GB를 시작점으로 보고 부하를 검증한다. 전처리 최대 메모리 실측은 약 2.94GiB이므로 이미지 빌드는 별도 메모리 여유가 있는 환경에서 수행한다. TLS, 패치, 모니터링, 그래프 갱신과 롤백 운영이 추가된다. 동일 OSRM API를 유지하면 Worker의 제공자 주소만 전환할 수 있다. [Lightsail 요금](https://aws.amazon.com/lightsail/pricing/) · [서울 리전 지원](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-regions-and-availability-zones-in-amazon-lightsail.html)

관리형 Route 검증 후보인 Mapbox Directions는 최대 25좌표를 한 요청으로 받고 지점마다 100m 스냅 반경을 지정할 수 있다. 월 10만 요청까지 $0, 그다음 구간은 1,000요청당 $2다. 월 15만 요청이면 검증 호출 기준 $100이다. 한국 표본, 모든 스냅 거리·구간 수·왕복 순서, 오류 분류와 위치 전달 조건을 먼저 검증해야 한다. Matrix는 별도 요소 단가를 사용한다. [Mapbox Directions 계약](https://docs.mapbox.com/api/navigation/directions/) · [Mapbox API 요금](https://www.mapbox.com/pricing/#navigation)
