> 과거 제공자 조사 기록입니다. 현재 요구사항은 차량 순정 내비 사용이며 타사 지도 길찾기 API는 사용하지 않습니다.

# 2단계 경로 제공자 조사 및 적용 상태

조사일: 2026-10-30. 제공자 확정이나 계약은 하지 않았으며, 다음은 공개 문서 기준이다. 국내 실주행 비교 테스트는 수행하지 않아 지역별 품질 우열은 알 수 없다. 가격과 이용 조건은 변경될 수 있으므로 계약 전에 재확인한다.

| 항목 | 카카오모빌리티 길찾기 | 네이버클라우드 Directions | TMAP API |
|---|---|---|---|
| 국내 범위·품질 | 국내 자동차 경로 상품. 실제 지역별 정확도·최신성은 미검증 | 자동차 길찾기와 실시간 교통 반영을 문서화. 실제 지역별 품질 미검증 | 실시간 교통을 활용한 경로 상품. 실제 지역별 품질 미검증 |
| 경유·왕복 | 일반 자동차 최대 5개, 다중 경유지 최대 30개. 전체 1,500km 미만. 출발·도착 5m 이내 오류 코드 104: 왕복을 여러 요청으로 나누는 방식 검토 필요 | Directions 5 최대 5개, Directions 15 별도. 동일 출발·도착 오류 코드 1, 경유지 직선거리 합 1,500km 이상 오류. 구간별 요청 검토 필요 | 순서 지정 다중 경유지 30개 상품. 동일 출발·복귀 처리 및 제한은 확인 필요 |
| 요금·한도 | 공개 가격표상 자동차 일 10,000건, 다중 경유지 일 5,000건; 초과분 자동차 8원, 다중 경유 16원/건(표의 월간 구간). 계약과 공통 월간 쿼터 확인 필요 | 실제 과금표·무료 한도 확인 못함 | 약관상 경로안내 일 1,000건, 다중 경유 30 일 100건. 종량 단가 확인 못함; 정액제 안내 월 200만원 VAT 별도 |
| 경로·회피·통제 | 경로선·구간·통행료; 무료/유료도로 등 회피, 도로 전체 통제 반영 옵션. 정보의 완전성은 미검증 | 경로선·거리·시간·통행료; 무료 우선 및 자동차전용 회피 우선. 통제 정보 범위 확인 필요 | 실시간 교통 소개. 회피·통제·통행료의 상품별 세부 범위 확인 필요 |
| 상업·표시·보관·재배포 | 앱 등록 및 키 필요. 제휴 전용 API는 별도 계약. 경로선의 지도/3D 표시, 캐시·재배포·상업 권리는 개별 약관/계약 확인 필요 | 계정/인증 및 상품 조건, 상업 사용, 지도·3D 표시, 캐시·재배포 확인 필요 | 유료 상품 안내; 약관상 API 데이터 저장 후 24시간 이상 사용 금지. 지도·3D 표시 및 재배포, 계약 적용 범위 확인 필요 |

공식 자료: [카카오 기능](https://developers.kakaomobility.com/guide/navi-api/start), [카카오 자동차](https://developers.kakaomobility.com/guide/navi-api/directions), [오류 코드](https://developers.kakaomobility.com/guide/navi-api/reference.html), [가격](https://developers.kakaomobility.com/price/), [제휴 자동차 API](https://developers.kakaomobility.com/affiliate/navi-api/directions.html), [네이버 Directions 5](https://api.ncloud-docs.com/docs/ai-naver-mapsdirections-driving), [Directions 15](https://api.ncloud-docs.com/docs/ai-naver-mapsdirections15-driving), [TMAP 소개](https://tmapapi.tmapmobility.com/), [TMAP 약관](https://tmapapi.tmapmobility.com/terms.html).

공개 문서의 기능이 실제 차량 통행을 보장하지 않는다. 어떠한 제공자에도 사용 승인, 키, 실제 호출 검증이 없다. 구현은 `RoadProvider` 인터페이스와 `MockProvider`만 제공하며, 요청 전체를 여러 구간으로 나누는 실제 제공자 어댑터는 구현하지 않았다. 승인 후 각 구간의 제한, 실패·응답 검증, 현재 스냅 거리와 접근성, 요청량·요금, 경로선 사용 권한 및 실제 구간 연결을 검증해야 한다.

# API 변경과 개인정보

기존 `POST /api/recommendations` 입력에 `returnLatitude`, `returnLongitude`를 함께 선택적으로 추가한다. 생략 시 출발 위치로 복귀한다. 기존 응답 필드는 유지하고 각 코스에 `route`를 추가한다. `route.points`는 출발→3개 자동 경유→복귀 순서의 좌표·유형·출처·검증 상태이며, `legs`는 연속 지점별 거리·시간, `distanceKm`, `drivingSeconds`, `stopSeconds`, `totalSeconds`는 합계다. 이동 시간에 정차 15분 및 선택 산책 시간을 더해 시간 조건을 판정한다. 전체 실패·시간 초과·기상 제외 개수와 조건 조정 안내를 반환한다. 이 버전의 값은 모두 목 직선거리 × 1.18, 평균 55km/h 추정이고 `ESTIMATED_NOT_ROAD_ROUTED`, `mock-straight-line`, `geometryStatus=NOT_AVAILABLE`로 표시된다. 거리·시간은 실제 도로 기준이 아니다.

10개 코스의 경유점은 기존 지형 자산의 2026-10 과거 OSRM/OSM 도로 스냅 결과다. 원래 지점과 스냅점 간 거리가 500m 초과하면 진입 불확실 경고를 표시한다. 500m는 임의의 경고 기준이며 실제 도로와의 현재 거리나 접근 가능성을 판정하지 않는다. 출발·복귀·각 경유지 모두 실제 제공자의 최신 스냅 및 통행 검증이 필요하다. 지형은 각 코스의 `HIGHLIGHT_ONLY` 범위이며 파일 부재 시 `UNAVAILABLE`; 전체 왕복 지형이 아니다. 고도와 도로 데이터의 기존 라이선스 및 저작자 표시는 기존 README와 서비스 정보에 유지한다.

위치·복귀 좌표와 차량 입력은 요청 처리 메모리에만 사용하고 DB·파일에 저장하지 않는다. 외부 경로 호출·위치 전송은 없다. 브라우저에는 기존대로 저장 코스 ID만 남는다. 실제 제공자 연결 시 위치 전송 및 보관 정책을 다시 문서화하고 사용자에게 알려야 한다.
