# T2-1C TAGO 정류장 매칭 진단

## 사용 방법

`.env.local`에 아래 값을 추가하고 `npx vercel dev`를 다시 시작한다.

```env
TAGO_BUS_ARRIVAL_DIAGNOSTICS_ENABLED=true
```

진단은 `VERCEL_ENV`와 `NODE_ENV`가 Production이 아닐 때만 활성화된다. 기존
실시간 도착정보 버튼을 한 번 누르면 카드의 `로컬 TAGO 매칭 진단`에서 다음을
확인할 수 있다.

- TMAP 승차 정류장 이름과 좌표
- 공식 도시코드 수와 인근 정류장 응답 건수
- TAGO 후보별 정류장 이름, `nodeId`, TMAP 좌표와의 거리
- 정규화한 정류장 이름의 일치 여부
- 후보 정류장 경유 노선번호
- 노선 경유 정류장 수와 진행 방향 검증 결과
- 파이프라인의 마지막 단계와 종료 이유

원본 TAGO 응답, 서비스 키, Supabase JWT, 인증키가 포함된 요청 URL은 표시하거나
로그로 남기지 않는다. 진단 데이터의 `source: live`는 Mock이 아니라 실제 TAGO를
통해 얻은 정규화 데이터라는 뜻이다.

## 단계와 판정 해석

| 마지막 단계 | 주요 판정 | 의미 |
|---|---|---|
| `city_codes` | `NEARBY_STOPS_HAVE_UNSUPPORTED_CITY_CODE` | 인근 정류장은 있으나 공식 도시코드 목록과 연결되지 않음 |
| `nearby_stops` | `NO_NEARBY_STOPS` | 좌표 기반 인근 정류장 응답이 비어 있음 |
| `nearby_stops` | `NO_STOP_WITHIN_120M` | 후보는 있으나 모두 TMAP 좌표에서 120m 초과 |
| `nearby_stops` | `STOP_NAME_MISMATCH` | 120m 안 후보가 있지만 정규화 이름이 다름 |
| `routes_at_stop` | `ROUTE_NUMBER_MISMATCH` | 정류장은 맞지만 요청 노선번호가 경유 노선에 없음 |
| `direction` | `DIRECTION_VERIFICATION_FAILED` | 경유 목록에서 승·하차 정류장을 찾지 못함 |
| `direction` | `DIRECTION_REVIEW_REQUIRED` | 순환·분기·중복·순서 누락 등으로 자동 확정 불가 |
| `arrivals` | `NO_MATCHING_ARRIVAL` | 방향까지 검증됐지만 해당 노선 도착정보가 없음 |
| `arrivals` | `AVAILABLE` | 도착정보 조회 성공 |

HTTP 오류 응답에서는 개발자 도구 Network의 `/api/tago/bus-arrival` 응답에
`diagnostics.failedStage`가 추가된다. TAGO 인증 오류, 한도 초과, 응답 형식 오류는
기존 오류 코드와 함께 확인하며 일반 `stop_match_failed`로 바뀌지 않는다.

## 성동세무서앞 확인 절차

1. 진단을 켜고 지선 2222 구간을 다시 한 번만 조회한다.
2. `nearbyStopCount`와 후보별 거리를 확인한다.
3. 120m 이내 후보에서 `성동세무서앞`과 TAGO 후보 이름의 차이를 확인한다.
4. 이름이 일치한다면 후보의 노선 목록에 `2222`가 있는지 확인한다.
5. 방향 검증까지 진행됐다면 `directionChecks.reason`을 확인한다.
6. 같은 요청은 30초 캐시되므로 설정 변경 후에는 서버를 재시작하거나 30초 뒤
   한 번만 다시 조회한다.

실제 후보 데이터가 확인되기 전에는 120m 제한이나 이름 비교 규칙을 완화하지
않는다. 표기 차이가 원인으로 확인되면 해당 차이만 테스트로 고정한 뒤, 노선번호와
진행 방향 검증을 통과하는 후보에 한해 최소 범위로 보완한다.
