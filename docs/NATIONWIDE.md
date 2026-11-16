# 전국 동적 코스 전환

작업 브랜치: `codex/nationwide-dynamic`. 기존 위치 출처 변경은 기준 커밋으로 보존한다.
운영 반영은 데이터·코드 검증 후 진행하며 실차 명령은 실행하지 않는다.

## 현재 계약 분석

- Workers `recommendations.ts`는 `courses.json` 10건을 순회하며 운영에서는 도로 제공자를 강제로 끈다.
- `selected-route.ts`의 재검증과 Java `Application`도 같은 고정 ID에 의존한다.
- 웹은 API 응답 ID를 `courses.js`에서 찾고 없으면 실패한다. 저장 목록도 고정 ID만 허용한다.
- 지형은 `terrain-view.js` → `terrain-model.js`의 검증된 격자/도로 모델을 사용하지만 로더 URL은 고정 ID 파일이다.
- 서명 티켓은 코스 ID와 경유지 순서·좌표를 포함하므로 동적 ID를 허용할 수 있다. 원래 서명된 좌표를 재검증해야 한다.
- Tesla는 사용자가 전송 준비·확인을 눌러야 명령을 실행한다. Pleos는 서명 티켓을 서버에서 검증한다. 이 경계를 유지한다.
- 신규 공개 POI 테이블·활성 스냅샷 포인터를 사용하고 세션 테이블은 변경하지 않는다.

## 원칙

수집은 배치로만 실행한다. 실패한 스냅샷은 활성화하지 않는다. 요청에서 전체 데이터/Overpass를 조회하지 않는다.
도로 연결과 명소 진입·주차 가능성은 구분한다. 확인되지 않은 접근은 차량 자동 전송 가능으로 표시하지 않는다.
개인 출발지는 DB에 저장하지 않으며 요청 ID 중복 방지는 메모리에서만 짧게 유지한다.

## 공식 근거

- OSM 대한민국 추출·변경 자료: https://download.geofabrik.de/asia/south-korea.html
- OSM 저작자 표시/ODbL: https://www.openstreetmap.org/copyright
- Pyosmium geometry/area: https://docs.osmcode.org/pyosmium/latest/user_manual/03-Working-with-Geometries/
- TourAPI 국문 서비스/이용 조건: https://www.data.go.kr/data/15101578/openapi.do
- OSRM Table/Route: https://project-osrm.org/docs/v5.24.0/api/
- D1 한도: https://developers.cloudflare.com/d1/platform/limits/

OSM 파생 DB의 ODbL 제공 의무를 유지한다. TourAPI는 별도 제공자 스냅샷으로 보관하고 원본 사진은 수집하지 않는다.
두 DB의 결합·재배포 라이선스 적합성은 서비스 공개 전 제공 조건을 다시 확인한다.
