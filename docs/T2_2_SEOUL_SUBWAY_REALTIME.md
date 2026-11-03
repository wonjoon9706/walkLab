# T2-2 서울시 지하철 실시간 도착정보

## 적용 범위

- 사용자가 선택한 TMAP 지하철 구간에서 조회 버튼을 눌렀을 때만 호출한다.
- TMAP 승차역 이름, 노선 유형, 다음 역, 하차역과 서울시 응답의 역명, `subwayId`, `trainLineNm`, `btrainSttus`를 비교한다.
- 역·노선·방향·일반/급행을 안전하게 확인한 경우에만 최대 두 열차를 표시한다.
- `barvlDt`는 초 단위로 유지하고 화면에서 분·초로 변환한다. `recptnDt`는 서울시 데이터 생성 시각으로 보존한다.

## 보안 및 호출 제한

서울시 API는 실측된 HTTP 주소만 사용하므로 로컬 Vercel 함수에서만 활성화한다. 브라우저는 서울시 API나 키에 직접 접근하지 않는다. 서버 함수는 Supabase JWT와 `TMAP_TRANSIT_ALLOWED_USER_ID`를 확인하고, 동일 요청을 30초간 캐시하며, 8초 후 중단한다. 자동 폴링과 자동 재시도는 없다.

`.env.local`에 다음 값을 추가한다. 실제 키는 문서나 Git에 복사하지 않는다.

```dotenv
SEOUL_SUBWAY_REALTIME_KEY=발급받은_서울시_키
SEOUL_SUBWAY_REALTIME_LOCAL_ENABLED=true
```

기존 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `TMAP_TRANSIT_ALLOWED_USER_ID`도 필요하다. 설정 후 `vercel dev`를 다시 시작한다.

## 최소 수동 검증

1. 로그인한 허용 계정으로 TMAP 경로를 한 번 검색한다.
2. 건대입구 2호선 구간을 선택해 해당 지하철 구간의 조회 버튼을 한 번 누른다.
3. 2호선, 다음 역 방향, 첫 번째·두 번째 열차, 생성/조회 시각을 확인한다.
4. 건대입구 7호선 경로에서도 한 번 조회해 2호선 열차가 섞이지 않는지 확인한다.
5. 역명 또는 방향을 확인할 수 없는 경로는 확인 불가로 표시되고 기존 TMAP 경로는 유지되는지 확인한다.

Production과 배포 환경에서는 HTTP 호출이 차단되며, HTTPS 동작이 별도로 검증되기 전까지 활성화하지 않는다.
