# T2-1D 서울시 실시간 버스 도착정보 통합

## 적용 범위

기존 `/api/tago/bus-arrival` 서버 함수가 인증·허용 사용자·30초 중복 방지를 계속
담당한다. 로컬에서 서울시 API를 명시적으로 켜고 승차 좌표가 서울 서비스 영역에
있을 때만 서울시 버스 API를 먼저 사용한다.

1. `getStationByPos`: 승차 좌표 주변 정류장 조회
2. `getStationByPos`: 하차 좌표 주변 정류장 조회
3. `getRouteByStation`: 승차 정류장의 2222 같은 경유 노선 확인
4. `getArrInfoByRouteAll`: 노선 전체 정류장 순서와 첫 번째·두 번째 도착정보 확인

서울시 인근 정류장 결과가 완전히 비어 있으면 비서울 또는 서비스 영역 밖으로 보고
기존 TAGO 흐름으로 되돌린다. 서울시 후보가 존재하지만 이름·좌표·노선·방향이
확정되지 않으면 TAGO 후보로 임의 전환하지 않고 `stop_match_review_required` 또는
`stop_match_failed`를 반환한다.

## 안전한 매칭 조건

- TMAP 승차·하차 좌표에서 각각 120m 이내인 서울시 정류장만 사용
- 정규화된 TMAP/서울시 정류장 이름 일치
- 승차 정류장의 `arsId`로 조회한 노선번호 일치
- 서울시 노선 ID를 TMAP 노선 ID와 직접 비교하지 않음
- 노선 전체 응답에서 승차·하차 `stId`가 각각 한 번만 식별됨
- `staOrd(승차) < staOrd(하차)`인 경우에만 해당 방향 허용
- 후보가 둘 이상 남거나 순환·중복으로 순서를 확정하지 못하면 확인 필요 처리
- 첫 번째·두 번째 버스는 `arrmsgSec1/2`, `sectOrd1/2`를 분리해 표시

도착 초가 없을 때만 공식 `traTime1/2` 분 값을 초로 변환한다. 남은 정류장 수는
공식 `staOrd - sectOrd1/2`로 계산하며 필요한 필드가 없으면 임의로 추정하지 않는다.

## 응답 처리

서울시 JSON은 `msgHeader`, `msgBody.itemList`를 파싱한다. 실측 결과와 같이
`msgHeader.itemCount`가 0이어도 `itemList`에 데이터가 있을 수 있으므로 항목 배열을
기준으로 처리한다. 오류 헤더와 필수 필드가 깨진 항목은 정상 빈 결과로 바꾸지 않는다.

## 로컬 환경변수

```env
TAGO_SERVICE_KEY=기존_공공데이터포털_일반인증키
SEOUL_BUS_API_LOCAL_ENABLED=true

# 별도 서울시 승인 키를 사용할 때만 설정한다.
# SEOUL_BUS_SERVICE_KEY=별도_서버전용키
```

`SEOUL_BUS_SERVICE_KEY`가 없으면 기존 `TAGO_SERVICE_KEY`를 서버 내부에서 재사용한다.
같은 공공데이터포털 키라도 서울시 버스 서비스 활용 승인이 포함됐는지는 계정의
활용신청 목록에서 확인해야 한다. 키에 `VITE_` 접두사를 붙이지 않는다.

서울시 호스트는 현재 `http://ws.bus.go.kr`만 실측됐으므로 다음 조건을 모두
만족할 때만 호출한다.

- `SEOUL_BUS_API_LOCAL_ENABLED=true`
- `VERCEL_ENV`와 `NODE_ENV`가 Production이 아님
- 서버 함수에서 호출하며 브라우저 직접 호출이 아님

Production에서는 플래그가 켜져 있어도 서울시 HTTP를 호출하지 않고 기존 TAGO
동작을 유지한다. 서비스 키와 키가 들어간 원본 URL은 로그나 응답에 포함하지 않는다.

## 수동 확인

1. 환경변수를 설정하고 `npx vercel dev`를 다시 시작한다.
2. 허용된 Supabase 계정으로 로그인한다.
3. TMAP 결과에서 승차 정류장이 `우리은행화양동지점`, 노선이 지선 2222인 구간을
   선택해 실시간 조회 버튼을 한 번 누른다.
4. 카드 제공기관이 `서울시 버스 실시간`인지 확인한다.
5. 첫 번째와 두 번째 버스의 분·남은 정류장 수가 별도로 표시되는지 확인한다.
6. 같은 버튼을 30초 안에 다시 눌러 외부 요청이 반복되지 않는지 확인한다.
7. 브라우저 Network에는 WalkLab 서버 URL만 보이고 `ws.bus.go.kr`와 키가 노출되지
   않는지 확인한다.
8. 비서울 경로 한 건에서 기존 `TAGO 실시간` 흐름이 유지되는지 확인한다.

TMAP이 같은 좌표를 `성동세무서앞`처럼 서울시와 다른 이름으로 반환한다면 자동으로
`우리은행화양동지점`에 연결하지 않는다. 이는 별도 실데이터 확인이 필요한 남은
매칭 문제다.

공식 자료:

- [서울시 좌표기반 근접정류소 목록정보](https://data.seoul.go.kr/dataList/OA-15335/F/1/datasetView.do)
- [서울시 정류소별 경유노선 목록정보](https://data.seoul.go.kr/dataList/OA-15333/L/1/datasetView.do)
- [서울시 버스도착 정보 조회](https://data.seoul.go.kr/dataList/OA-1091/L/1/datasetView.do)
