# T2-1 TAGO 버스 도착정보 기반 설계

## 범위

T2-1은 선택한 TMAP 경로의 버스 구간을 TAGO 정류장·도착정보에 연결하기 위한 도메인 모델, 보수적 정류장 매칭, Mock UI까지 구현한다. 실제 TAGO 호출, 자동 폴링, 탑승 가능성 판정, 전체 ETA 재계산, DB·호출량 테이블 추가는 제외한다.

## 공식 응답에서 사용하는 필드

### TMAP 대중교통 경로

버스 `leg`에서 `route`, `routeId`, `type`, `start`, `end`를 얻을 수 있다. `passStopList.stationList`에는 `index`, `stationID`, `stationName`, WGS84 `lon/lat`가 있다. WalkLab은 기존의 노선명·버스 유형·승하차 이름에 `routeId`와 정류장 순서 목록 `stops`를 추가했다.

TMAP `stationID`는 TMAP 공급자 식별자로만 보존한다. TAGO `nodeid`와 같은 값이라고 가정하지 않는다.

### TAGO 버스정류소정보

`getCrdntPrxmtSttnList`는 WGS84 `gpsLati/gpsLong` 주변 반경 500m의 `citycode`, `nodeid`, `nodenm`, 정류장 좌표를 반환한다. 500m는 후보 수집 범위이며 자동 확정 범위가 아니다. WalkLab은 현재 120m 이내 후보만 비교한다.

### TAGO 버스도착정보

`getSttnAcctoArvlPrearngeInfoList`는 `cityCode`와 `nodeId`를 입력받아 `nodeid`, `nodenm`, `routeid`, `routeno`, `routetp`, `arrtime`(초), `arrprevstationcnt`를 반환한다. 응답의 `totalCount=0`은 운행정보 없음으로, 비정상 `resultCode`나 네트워크 실패는 API 오류로 분리한다.

## 정류장 매칭 규칙

1. TMAP 승차 정류장의 좌표로 TAGO 인근 정류장 후보를 구한다.
2. 120m를 넘는 후보를 제외하고 정류장 명칭을 NFKC 정규화한 뒤 공백·기호·`정류장/정류소` 접미 표현을 제거해 비교한다.
3. TMAP 노선명의 유형 접두사(예: `직행좌석:`)를 제거한 값과 TAGO `routeno`를 비교한다.
4. 같은 이름·노선 후보가 둘 이상이면 TMAP의 다음 정류장 방향과 TAGO 노선의 다음 정류장 방향을 비교한다. 방위 차가 60도 이내인 후보가 정확히 하나일 때만 확정한다.
5. 후보 없음·명칭 불일치·노선 불일치는 `failed`, 맞은편 정류장처럼 방향 증거가 부족하거나 둘 이상 남으면 `review_required`를 반환한다. 거리만으로 가장 가까운 후보를 강제 선택하지 않는다.

TAGO 버스정류소정보의 인근 검색 응답 자체에는 진행 방향이 없다. 정류장별 경유 노선 또는 노선별 경유 정류장 순서로 다음 정류장을 확보하는 실제 조합은 실데이터 검증이 필요하다. 해당 증거를 얻지 못한 복수 후보는 자동 매칭하지 않는다.

## 정규화 모델과 데이터 흐름

`BusArrivalInfo`는 노선명, 정류장명, TAGO 정류장 ID, 도착 예정 초, 남은 정류장 수, 조회 시각, 제공기관, 조회 상태를 분리한다. 상태는 다음과 같다.

- `available`: 정상 도착정보
- `no_service`: 정상 응답이나 현재 운행정보 없음
- `unsupported_region`: TAGO 미지원 도시
- `stop_match_failed`: 정류장 매칭 실패
- `stop_match_review_required`: 동일 이름·반대 방향 등 확인 필요
- `api_error`: 인증·할당량·타임아웃·비정상 응답

`arrivalSeconds`와 `walkingTimeToStopSeconds`는 독립 필드다. T2-1에서는 접근 도보시간을 연결하지 않아 `null`로 유지하며, 도착 예정시간과 합산하거나 전체 ETA를 다시 계산하지 않는다.

T2-1B에서 Mock 버튼은 버스 구간별 실제 조회 버튼으로 교체됐다. 선택 경로가 바뀌면 조회 결과를 폐기하며 자동 갱신하지 않는다. 실시간 상태가 없거나 오류여도 TMAP 추천 경로와 개인화 ETA는 그대로 남는다. 서버 연결과 로컬 검증 절차는 `docs/T2_1B_TAGO_LIVE_INTEGRATION.md`를 따른다. Mock 생성기는 외부 호출 없는 회귀 테스트 fixture로만 유지한다.

## 실제 연동 설정

1. 공공데이터포털에서 `국토교통부_(TAGO)_버스도착정보`와 `국토교통부_(TAGO)_버스정류소정보` 활용을 신청한다.
2. 서버 환경변수 `TAGO_SERVICE_KEY`에 일반 인증키(Decoding)를 넣는다. `VITE_` 접두사를 사용하지 않는다.
3. 실데이터 검증 전 `TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED=false`를 유지한다.
4. 향후 Vercel 서버 함수에서 기존 Supabase bearer token 검증과 `TMAP_TRANSIT_ALLOWED_USER_ID` 제한을 동일하게 적용한 뒤 TAGO를 호출한다.
5. 클라이언트에는 정규화된 응답만 반환하고 서비스 키, 인증 토큰, 민감한 원본 응답을 로그나 진단 UI에 출력하지 않는다.

TAGO 제공 도시, 실제 일일·초당 호출 제한, 운영 트래픽 증설, 응답 신선도, 정류장/노선 식별자 품질, 브라우저 직접 호출 가능 여부는 `검증 필요`다. 브라우저 직접 호출은 키 노출 때문에 사용하지 않는다.

## 실데이터 검증 전 남은 항목

- TMAP 노선명과 TAGO `routeno`의 지역별 표기 차이
- TAGO 인근 정류장 결과의 정렬·누락과 좌표 오차
- 노선별 다음 정류장 확보 방법과 순환·분기 노선 방향 판정
- 도시코드 경계와 광역버스의 출발·도착 지자체 처리
- `totalCount=0`, 미지원 도시, 인증·할당량 오류의 실제 응답 형태
- 실제 전광판/공식 앱 대비 `arrtime` 신선도와 iPhone Safari 표시 검증

## 공식 자료

- [TMAP 대중교통 경로 API](https://transit.tmapmobility.com/docs/routes)
- [TAGO 버스도착정보](https://www.data.go.kr/data/15098530/openapi.do)
- [TAGO 버스정류소정보](https://www.data.go.kr/data/15098534/openapi.do)
