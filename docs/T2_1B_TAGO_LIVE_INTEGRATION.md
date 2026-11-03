# T2-1B TAGO 실제 연동 및 로컬 검증

> T2-1B 당시 남아 있던 진행 방향 한계는 T2-1C에서 버스노선정보 API로
> 보완했다. 최신 동작과 수동 검증 절차는
> [T2_1C_TAGO_ROUTE_DIRECTION.md](./T2_1C_TAGO_ROUTE_DIRECTION.md)를 따른다.

## 구현 범위

선택한 TMAP 버스 구간에 대해서만 `/api/tago/bus-arrival` Vercel 함수를 수동 호출한다. 서버 함수는 Supabase JWT와 `TMAP_TRANSIT_ALLOWED_USER_ID`를 확인한 뒤 아래 순서로 TAGO를 조회한다.

1. `ArvlInfoInqireService/getCtyCodeList`: 공식 지원 도시코드 확인, 서버 메모리에서 24시간 재사용
2. `BusSttnInfoInqireService/getCrdntPrxmtSttnList`: TMAP 승차 좌표 주변 정류장 검색
3. `BusSttnInfoInqireService/getSttnThrghRouteList`: 후보 정류장의 경유 노선번호·TAGO 노선 ID 확인
4. `ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList`: 검증된 정류장의 도착정보에서 같은 TAGO 노선 ID와 노선번호 추출

JSON을 우선 요청한다. 공공데이터 게이트웨이가 XML 인증 오류를 반환하거나 정상 데이터를 XML로 반환해도 별도 파서로 처리한다. 인증키와 원본 요청 URL은 응답이나 로그에 넣지 않는다.

## 안전장치

- Production에서는 `TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED=true`가 아니면 외부 호출을 차단한다.
- 앱 진입, TMAP 경로 검색, 경로 선택만으로 TAGO를 호출하지 않는다.
- 각 버스 구간의 `실시간 도착정보 조회` 버튼 클릭만 호출을 시작한다.
- 한 번에 하나의 버스 구간만 조회한다.
- 같은 사용자·좌표·노선 결과는 클라이언트와 서버에서 각각 30초 동안 재사용한다.
- 전체 TAGO 조합 요청은 8초 후 중단하며 자동 재시도하지 않는다.
- DB 또는 호출량 관리 테이블을 추가하지 않는다.
- 도착시간과 정류장 접근 도보시간은 분리하며 ETA를 재계산하지 않는다.

메모리 캐시는 Vercel 인스턴스 사이에서 공유되지 않는다. 현재는 단일 허용 사용자의 로컬 검증과 짧은 중복 클릭 방지용이며 운영 호출량 보장을 의미하지 않는다.

## 진행 방향 한계

승인된 버스정류소정보의 인근 정류장·경유노선 응답과 버스도착정보 응답에는 해당 노선의 **다음 정류장 좌표 또는 정류장 순서**가 없다. 따라서 노선번호와 TAGO 노선 ID가 맞더라도 진행 방향을 검증할 수 없으면 `stop_match_review_required`를 반환하고 도착시간을 표시하지 않는다.

자동 방향 검증에는 `국토교통부_(TAGO)_버스노선정보`의 노선별 경유 정류소 목록 `getRouteAcctoThrghSttnList`가 추가로 필요하다. 해당 API 승인 후 TAGO 노선 ID의 현재 정류장 다음 순번과 TMAP 다음 정류장 방향을 비교해야 한다. TMAP `routeId/stationID`와 TAGO `routeid/nodeid`는 직접 비교하지 않는다.

- [TAGO 버스노선정보](https://www.data.go.kr/data/15098529/openapi.do)

## 환경변수

로컬 `.env.local`과 Vercel 서버 환경에는 다음 값을 사용한다. 실제 키는 저장소에 커밋하지 않는다.

```env
TAGO_SERVICE_KEY=공공데이터포털_일반인증키_Decoding
TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED=false
TMAP_TRANSIT_ALLOWED_USER_ID=허용할_Supabase_사용자_UUID
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`TAGO_SERVICE_KEY`에는 Decoding 키를 넣는다. 서버가 URL query를 안전하게 인코딩한다. `VITE_` 접두사를 붙이지 않는다.

## 로컬 수동 실데이터 테스트

이번 코딩 작업에서는 아래 절차를 실행하지 않았다. 키 설정 후 개발자가 한두 번만 수동으로 수행한다.

1. `.env.local`에 위 서버 환경변수를 설정하고 `TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED=false`를 유지한다.
2. `npx vercel dev`로 Vite와 Vercel 함수를 함께 실행한다. 일반 `npm run dev`만 사용하면 `/api/tago/bus-arrival` 함수 검증이 되지 않는다.
3. `TMAP_TRANSIT_ALLOWED_USER_ID`와 같은 계정으로 로그인한다.
4. TAGO 지원 도시의 익숙한 버스 경로를 TMAP에서 한 번 검색하고 버스 구간의 `실시간 도착정보 조회`를 한 번 누른다.
5. 현재 승인 범위에서는 정류장·노선 후보가 맞아도 방향 자료가 없으면 `정류장 확인 필요`가 정상적인 안전 결과다. 잘못된 맞은편 정류장 도착시간이 표시되어서는 안 된다.
6. 같은 버튼을 30초 안에 다시 눌러 화면 결과가 재사용되는지 확인한다. 자동 호출이나 반복 네트워크 요청이 없어야 한다.
7. 필요할 때만 30초 이후 다른 한 경로를 한 번 더 확인한다. 브라우저에는 WalkLab 서버 URL만 보여야 하며 TAGO 인증키나 `apis.data.go.kr` 원본 URL이 노출되면 안 된다.
8. 실제 도착시간까지 검증하려면 버스노선정보 API 승인을 받은 뒤 방향 연결을 구현하고, 공식 앱·정류장 전광판과 조회 시각·남은 정류장 수를 비교한다.

## 실데이터 확인표

| 사례 | 기대 결과 |
|---|---|
| 지원 도시·정상 정류장 | 도시·정류장·노선 파싱 후 방향 근거가 없으면 확인 필요 |
| 같은 이름의 반대편 정류장 | 자동 선택 금지 |
| 좌표·명칭 불일치 | `stop_match_failed` |
| 공식 목록에 없는 도시코드 | `unsupported_region` |
| 검증된 노선의 도착 항목 0건 | `no_service` |
| 키 오류 | `TAGO_AUTH_ERROR` |
| 호출 한도 초과 | `QUOTA_EXCEEDED` |
| 8초 초과 | `REQUEST_TIMEOUT` |
| 깨진 JSON/XML | `INVALID_RESPONSE` |
