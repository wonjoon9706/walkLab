# T2-1C TAGO 버스노선 진행 방향 검증

## 구현 범위

실시간 도착정보를 조회하기 전에 TAGO 버스노선정보의
`getRouteAcctoThrghSttnList`를 조회해 승차 정류장에서 하차 정류장으로 실제로
진행하는 노선인지 확인한다. 이 단계에서 사용하는 공식 응답 필드는 다음뿐이다.

- `routeid`: TAGO 노선 ID
- `nodeid`: TAGO 정류장 ID
- `nodenm`: 정류장 이름
- `nodeord`: 경유 순서
- `gpslati`, `gpslong`: 정류장 좌표
- `updowncd`: API가 반환한 상·하행 구분 원본값

`updowncd` 값의 의미는 코드에서 추측하지 않는다. 승차~하차 구간 안에서 값이
바뀌면 분기 또는 방향 충돌 가능성이 있다고 보고 자동 매칭하지 않는다.

## 데이터 흐름과 안전장치

사용자의 버스 구간 조회 클릭 한 번에 서버는 다음 순서로 처리한다.

1. Supabase JWT와 `TMAP_TRANSIT_ALLOWED_USER_ID`를 검증한다.
2. 공식 도시코드와 승차 좌표 주변의 TAGO 정류장을 확인한다.
3. 후보 정류장을 지나는 노선 중 TMAP 노선번호와 같은 후보를 찾는다.
4. 후보 TAGO 노선별 경유 정류장 전체 페이지를 조회한다.
5. 승차 정류장은 후보 `nodeid`와 이름·좌표가 모두 맞는지 확인한다.
6. 하차 정류장은 이름·좌표가 유일하게 맞는지 확인한다.
7. `nodeord(승차) < nodeord(하차)`이고 다음 정류장 방향도 TMAP과 맞을 때만
   도착정보 API를 조회한다.
8. 반환된 도착정보에서도 같은 TAGO 노선 ID와 노선번호인 항목만 사용한다.

경유 목록의 한 항목이라도 필수 필드가 깨졌으면 전체 응답을 거부한다. 정류장
좌표 또는 경유 순서가 빠졌거나, 정류장 ID·경유 순서가 중복되거나, 후보 노선이
둘 이상 남거나, 상·하행 코드가 구간 안에서 충돌하면
`stop_match_review_required`를 반환한다. 확정 실패와 확인 필요 모두 기존 TMAP
경로 표시에는 영향을 주지 않으며 도착정보 API를 호출하지 않는다.

노선 경유 목록은 서버 인스턴스 메모리에 도시코드+TAGO 노선 ID 기준으로 6시간,
최대 100개를 캐시한다. 실시간 결과의 30초 캐시는 노선번호+승차 좌표+하차 좌표를
키로 사용한다. 서버리스 인스턴스 간 공유 캐시나 DB 테이블은 추가하지 않았다.

## 자동 확정하지 않는 사례

- 순환 노선처럼 같은 정류장 ID가 경유 목록에 다시 등장하는 경우
- 분기 노선처럼 같은 순서가 중복되거나 승차~하차 구간의 `updowncd`가 충돌하는 경우
- 같은 이름·비슷한 좌표의 하차 후보가 둘 이상인 경우
- 승차 또는 하차 정류장이 경유 목록에 없거나 좌표·순서가 누락된 경우
- TMAP 다음 정류장 방향과 TAGO 경유 목록의 다음 정류장 방향이 맞지 않는 경우
- 같은 노선번호의 TAGO 노선 후보가 둘 이상 모두 검증되는 경우
- 공식 응답의 `routeid`가 요청한 TAGO 노선 ID와 다른 경우

경유 순서는 현재 반환된 한 노선 패턴 안의 앞뒤 관계만 보여 준다. 순환 노선의
회차 경계, 시간대별 단축 운행, 동일 노선 ID 안의 복수 분기 패턴을 완전히 증명하지
못할 수 있으므로 위 모호성은 사람이 확인해야 한다.

## 환경변수

로컬 `.env.local` 또는 Vercel 서버 환경에 다음 값을 설정한다. 공공데이터포털에서
버스도착정보·버스정류소정보·버스노선정보가 모두 승인된 동일한 일반 인증키
(Decoding)를 `TAGO_SERVICE_KEY`에 넣는다. `VITE_` 접두사를 붙이지 않는다.

```env
TAGO_SERVICE_KEY=공공데이터포털_일반인증키_Decoding
TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED=false
TMAP_TRANSIT_ALLOWED_USER_ID=허용할_Supabase_사용자_UUID
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Production은 `TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED=true`를 명시하기 전까지 실제
TAGO 요청을 차단한다. 인증키와 인증키가 포함된 원본 URL은 응답이나 로그에 남기지
않는다.

## 최소 로컬 실데이터 확인 순서

이번 코딩 작업에서는 아래 절차를 실행하지 않았다. 키 설정 후 개발자가 수동으로
최소 횟수만 확인한다.

1. `npx vercel dev`로 Vite와 Vercel 함수를 함께 실행한다.
2. 허용 UUID 계정으로 로그인하고 TAGO 지원 도시의 버스 경로를 한 번 검색한다.
3. 한 버스 구간에서 `실시간 도착정보 조회`를 한 번 누른다.
4. 서버 응답이 `available`, `no_service`, `stop_match_review_required` 중 실제 데이터에
   맞게 나오는지와 기존 경로가 계속 표시되는지 확인한다.
5. 같은 버튼을 30초 안에 한 번 더 눌러 외부 호출이 늘지 않는지 확인한다.
6. 가능하면 반대편 정류장이 가까운 경로 한 건만 추가로 조회해 잘못된 방향의
   도착정보가 표시되지 않는지 확인한다.
7. 브라우저 네트워크에는 WalkLab `/api/tago/bus-arrival`만 보이고 인증키나
   `apis.data.go.kr` 원본 URL이 노출되지 않는지 확인한다.

공식 문서: [국토교통부 TAGO 버스노선정보](https://www.data.go.kr/data/15098529/openapi.do)
