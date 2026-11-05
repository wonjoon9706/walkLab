# Production 버스 도착정보 복구 진단과 현재 보행시간 연결

## 확인된 사실과 미확인 사항

사용자 실측: `/api/kakao/seoul-bus-evidence`의 `nearby_stops`, `routes_at_stop`가 HTTP 504이며 `route_arrivals`는 확인되지 않았다. 따라서 버스 도착정보보다 앞선 정류장/노선 검증 통신이 실패하고 있다. 현재 Access 검증기는 이 두 API가 성공한 후 노선명이 일치해야 `getRouteArrivals`를 호출한다. 그 전 실패하면 검증 후보가 생기지 않는다.

HTTP 504만으로는 Vercel 함수 강제 종료와 앱이 반환한 서울시 대기시간 초과를 구분할 수 없다. 실제 Vercel 로그, 프로젝트 Fluid Compute/실행시간/리전 설정, 서울시 응답 시간, 운영 키 권한은 이번 작업 환경에서 확인하지 못했다. 인증된 Vercel CLI 및 연결된 프로젝트 설정도 없었다. 운영 통신이 복구되었다고 보고하지 않는다.

공식 Vercel 문서: https://vercel.com/docs/functions/configuring-functions/duration

- Fluid Compute의 Hobby 기본/최대는 300초, 비활성화한 기존 방식의 기본은 10초다. 프로젝트의 실제 설정은 별도 확인해야 한다.
- 기존 코드는 인증 뒤에 서울시 10초 타이머를 시작하므로, 전체 실행시간이 10초를 넘을 수 있었다.
- 인증 5초와 서울시 10초의 응답 기한을 별도로 관리하고, 이 API만 실행 예산을 20초로 명시했다. 서울시 요청 대기시간 자체는 늘리지 않았다.
- AbortSignal에 응답하지 않는 요청도 Promise deadline으로 종료한다. 공유 요청은 소유한 하나의 deadline을 사용한다.
- HTTP 호스트, 인증서 검증, 리전은 추측으로 변경하지 않았다. 재시도 루프나 프록시를 추가하지 않았다.

## 호스트와 키

현재 서버는 기존 `http://ws.bus.go.kr/api/rest`를 사용하며 다음을 호출한다.

| operation | 기존 서울시 오퍼레이션 |
|---|---|
| nearby_stops | stationinfo/getStationByPos |
| routes_at_stop | stationinfo/getRouteByStation |
| route_arrivals | arrive/getArrInfoByRouteAll |

`SEOUL_BUS_SERVICE_KEY`가 우선이고, 없으면 `TAGO_SERVICE_KEY` 문자열을 사용한다. Decoding 키를 `URLSearchParams`로 인코딩한다. 변수 재사용은 사용 권한을 보장하지 않는다. 공공데이터포털에서 서울특별시 정류소정보조회(15000303)와 버스도착정보조회(15000314)의 승인/키/유효기간을 각각 확인해야 한다. TAGO 서비스와는 별도다. 실 키를 사용한 이번 호환성 검증은 수행하지 않았다.

카카오 검색 허용 플래그나 TAGO 전용 운영 플래그가 이 서울시 endpoint를 직접 차단하지는 않는다. Supabase JWT, `TRANSIT_ALLOWED_USER_ID`, 서울시 키는 계속 필수다. GPS 저장 성공은 서울시 통신 성공의 증거가 아니다.

## 운영에서 확인할 진단

인증 URL, 키, JWT, 이용자 ID, 개인 좌표, 노선 ID, 원본 오류 메시지를 로그에 남기지 않는다.

- 응답 `X-Smart-Arrival-Request-Id`: 서버 로그와 대응하는 무작위 요청 ID.
- 응답 `Server-Timing`: `auth`, `upstream` 경과시간(ms).
- 안전한 구조 로그: operation, stage, status, code, elapsedMs, authMs, upstreamMs, keySource(변수 출처만), cacheStatus.
- 제공기관 HTTP 상태, 숫자 providerCode, 허용 목록의 연결 오류 코드만 추가한다.
- 시작 로그는 있고 완료 로그가 없으며 Vercel에서 `FUNCTION_INVOCATION_TIMEOUT`이 보이면 함수 제한/프로세스 종료를 확인한다.
- `AUTH_REQUEST_TIMEOUT`: 인증 서버 응답 5초 초과. 서울시 API는 호출하지 않는다.
- `REQUEST_TIMEOUT`: 서울시 요청 10초 초과. DNS/연결/본문 지연의 상세 구분은 네트워크 코드와 운영 로그가 필요하다.
- JSON 없이 HTTP 504인 경우 클라이언트는 `GATEWAY_TIMEOUT`, Vercel 오류 헤더가 있으면 `FUNCTION_INVOCATION_TIMEOUT`으로 보존한다.
- `SEOUL_BUS_AUTH_ERROR`: HTTP 401/403 또는 명시적 JSON/XML 인증 오류. 키와 승인 상태 확인.
- `SEOUL_BUS_API_ERROR`, `INVALID_RESPONSE`, `NETWORK_ERROR`, `QUOTA_EXCEEDED`는 정류장 없음과 구분한다.

### 사용자 승인 후 배포한 환경의 최소 재검증

1. Vercel의 해당 배포 함수 설정에서 실제 실행시간과 리전을 확인한다. Production 범위 키·Supabase 설정·허용 사용자 UUID를 확인하되 값을 복사/로그하지 않는다.
2. Network 기록을 유지하고 버스 경로를 한 번 검색한다. `seoul-bus-evidence`만 필터링한다.
3. 실패 요청의 operation, HTTP 상태, 응답 code, 두 진단 헤더만 확인한다. 요청 본문/Authorization/전체 URL은 공유하지 않는다.
4. Vercel 로그에서 요청 ID를 검색한다. 앱 타임아웃과 함수 종료를 구분하고, 연결 실패가 지속되면 리전/외부 통신 경로 또는 서울시 제공기관 지원을 확인한다. 근거 없이 리전/호스트를 변경하지 않는다.
5. 선행 통신이 회복되면 상세의 도착정보 새로고침을 한 번 누른다. 후보가 없던 경우 같은 Access 검증기로 정류장부터 재검증한다. 하차 경로·카카오 대중교통 전체 경로는 재검색하지 않는다.
6. 같은 정류장·노선의 진행 순서가 유일하게 검증된 경우에만 버스 도착정보를 표시한다. 빈 결과는 도착정보 없음이며 0초를 생성하지 않는다.

## 현재 보행시간으로 탑승 판단

기존 `composeTransitBoardingPlan`에 선택적인 첫 버스 접근시간만 전달한다. 기본 입력이 없는 T2-3/T2-4A와 지하철 판정은 기존 정책을 유지한다.

- 같은 안내 routeId, 같은 G8 객체, 검증된 접근 연결일 때만 사용한다.
- 안정된 현재 속도가 있으면 G9의 `remainingDurationSeconds`를 그대로 사용한다. G9 속도/ETA 계산식은 바꾸지 않는다.
- 위치는 유효하지만 현재 속도가 확인 중/정지 중이면 **남은 경로거리 / 기존 G7 또는 기본속도**로 계산한다. 정지 시에는 다시 걸을 때의 참고값이다.
- GPS 20초 이상 미갱신, 경로 이탈, 미확정 연결, 권한 오류, 종료된 안내는 판단을 보류한다. 전체 출발 도보시간으로 되돌려 이미 걸은 거리를 다시 더하지 않는다.
- 버스 도착 절대시각 = 원본 fetchedAt + arrivalSeconds. 정류장 도착 예상시각 = 동일한 현재 시각 + 남은 접근시간. 두 값의 차이로 판단한다.
- UI는 G9의 기존 도착 절대시각과 남은 시간에서 평가시각을 얻어 재사용한다. 새 GPS watcher나 외부 API polling은 추가하지 않는다.
- 기존 120초 신선도, 출발대기/모순 ETA 제외, 준비 30초, 예측 변동 90초(여유 120초 이상 가능성 높음, 30~119초 촉박, 30초 미만 어려움)를 유지한다. 이는 정책 여유값이며 실측 오차 보장이 아니다.

예를 들어 도착 6분, 남은 도보 4분30초는 여유 90초이므로 기존 보수적 기준에서는 **시간이 촉박함**이다. 시간을 생성하거나 탑승을 보장하지 않는다. 환승 이후 버스에 현재 예측을 연결하지 않는다.

## 검증 범위

모의 서버 응답으로 인증 타임아웃, upstream 미응답, 진행 요청 공유·실패 후 재시도, 오류 JSON/비JSON 504, 키 우선순위, 캐시 시각 보존을 검증한다. 실제 Access 검증기와 첫 승차 훅을 연결한 테스트, 수동 재검증 UI, 현재 남은 시간·G7 fallback·GPS 중단·데이터 만료·Hooks 순서 회귀를 포함한다.

실제 서울시/Production API 호출은 이번 수정의 자동 테스트와 구분한다. 코드 수정 및 로컬 테스트만으로 Production 복구를 확정하지 않는다.
