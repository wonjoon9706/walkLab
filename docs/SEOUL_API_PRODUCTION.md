# 서울시 API 운영 허용 및 G8 통합

## 적용 정책

개인 포트폴리오 프로젝트에서 서울시 공식 HTTP API의 **서버 간 호출**을 개발·Preview·Production에 동일하게 허용한다는 사용자 지시에 따른다.
HTTP 구간은 암호화되지 않는다. HTTPS 지원을 확인했다거나 TLS로 보호된다고 주장하지 않는다.
브라우저는 기존 WalkLab API만 호출하며 서울시 키를 직접 받지 않는다. 공개 프록시·인증서 검증 해제는 추가하지 않았다.

## 변경한 제한

- `/api/kakao/seoul-bus-evidence`: `isRemoteDeployment()` 차단 제거. JWT·허용 UUID 확인 후 서울시 정류장·노선·노선별 도착정보를 조회한다.
- `/api/subway/arrival`: Production/Preview/NODE_ENV 차단 및 로컬 활성화 플래그 제거. 기존 역명·노선명·다음역·하차역·일반/급행 검증과 recptnDt 보정을 그대로 사용한다.
- `/api/tago/bus-arrival`: 서울 좌표는 환경과 관계없이 서울시를 우선 사용한다. TAGO 운영 플래그는 실제 TAGO 조회가 필요할 때만 적용한다. 비서울/대체 TAGO 조회에는 기존 명시적 운영 허용이 필요하며 Preview에도 적용한다.
- 서울시 버스는 `SEOUL_BUS_SERVICE_KEY` 우선, 없으면 기존 `TAGO_SERVICE_KEY`를 사용한다. 서울시만 사용하는 요청에 TAGO 키가 따로 없다고 실패하지 않는다.
- `isRemoteDeployment()` 자체는 유지한다. 카카오의 `KAKAO_TRANSIT_PRODUCTION_ENABLED`와 로컬 비밀파일 로딩·민감 진단 제어에는 계속 필요하다.
- 화면의 항상 표시되던 “운영에서 서울시 미제공” 안내를 제거했다. 실제 오류가 있을 때만 해당 원인을 표시한다.

## 보호 및 안정성

- 기존 Supabase JWT·`TRANSIT_ALLOWED_USER_ID` 검증, 키 누락 오류와 서버 측 키 관리를 유지한다.
- 공식 호스트는 버스 `ws.bus.go.kr`, 지하철 `swopenAPI.seoul.go.kr`로 고정한다. 사용자가 URL을 지정할 수 없고 `redirect: 'error'`로 다른 호스트로 리다이렉트되는 요청도 막는다.
- 버스 증거 API는 좌표·operation·정류장/노선 식별자를 검증한다. 비정상 입력에 외부 API를 요청하지 않는다.
- 버스 증거 API의 정류장·노선 응답은 사용자/파라미터별 30초, 최대 100개 인스턴스 메모리 캐시로 재사용한다. 진행 중 동일 요청도 공유한다. 실패는 캐시하지 않는다.
- 노선 도착정보는 기존 클라이언트 30초 캐시와 진행 중 요청 공유를 사용한다. 새 서버 캐시를 중첩해 도착정보 조회 시각을 새 시각처럼 보이게 하지 않는다.
- 기존 버스/지하철 도착정보 서버 캐시, 타임아웃 및 중복 요청 방지는 유지한다. DB 테이블이나 무한 재시도·자동 갱신은 추가하지 않았다.
- 위 메모리 캐시는 함수 인스턴스별이므로 모든 Vercel 인스턴스의 전역 호출량을 보장하지 않는다. 제공기관 한도 오류는 별도로 처리한다.
- API 키·JWT·개인 좌표·인증 URL 로그를 추가하지 않았다.

## 오류 구분과 G8 보존

키/설정 누락은 `SERVER_NOT_CONFIGURED`, 연결은 `NETWORK_ERROR`, 타임아웃은 `REQUEST_TIMEOUT`, HTTP 429는 `QUOTA_EXCEEDED`, 비정상 데이터는 `INVALID_RESPONSE`로 구분한다.
버스 HTTP 401/403은 `SEOUL_BUS_AUTH_ERROR`, 제공기관 오류는 `SEOUL_BUS_API_ERROR`로 구분한다. 지하철 인증·제공기관 오류도 기존 코드와 별도 안내를 유지한다.
정상 빈 배열은 API 오류가 아니다. 정류장 없음·방향 불일치·복수 후보와 분리한다.
클라이언트는 안전한 오류 코드를 보존하고 개발 진단에 `API_NOT_CONFIGURED`, `API_AUTH_ERROR`, `API_TIMEOUT`, `API_QUOTA_EXCEEDED`, `API_INVALID_RESPONSE`, `API_CONNECTION_FAILED`, `API_PROVIDER_ERROR`로 전달한다.

이전 미커밋 G8 개선사항을 보존했다.

- 실제 검증된 단일 정류장 좌표가 확보되면 기존 G8 경로를 우선 사용한다.
- 검증 API 실패/후보 없음에서는 유효한 단일 카카오 BUS 끝점 기반 참고 G8 계산이 계속 가능하다. 실제 정류장·실시간 매칭 좌표로 승격하지 않는다.
- 지하철 하차의 `WALKING_ENDPOINT_MISMATCH`, 단일 후보 참고 ETA·점선 지도선을 유지한다.
- 양끝 도보 반영·부분 개인화 참고·계산 불가를 구분하고 목록/상세의 ETA를 일치시킨다.
- G7/G8 계산식, 3개 우선 경로/더보기, 캐시·취소 정책은 유지한다.
- GPS 자동 종료는 기존 검증된 좌표만 사용한다. 40m 반경·정확도 30m·신규 유효 위치 3회·중복/도약/오래된 위치 방어와 마지막 GPS 저장은 변경하지 않았다.
- G2/G6/G7·IndexedDB·Supabase 동기화 및 DB 스키마는 변경하지 않았다.

## Vercel 환경변수

새 필수 변수는 없다. 기존 설정을 재사용한다.

| 설정 | 값/용도 |
| --- | --- |
| `KAKAO_TRANSIT_PRODUCTION_ENABLED` | 기존 카카오 검색·출입구 조회에 `true` 필요 |
| `TRANSIT_ALLOWED_USER_ID` | 기존 허용 사용자 UUID |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | 기존 서버 인증 설정. 기존 공개 Supabase 값 fallback도 유지 |
| `KAKAO_REST_API_KEY`, `VITE_KAKAO_MAP_JS_KEY` | 기존 서버 REST 키·공개 지도 키 |
| `SEOUL_BUS_SERVICE_KEY` | 선택. 없으면 기존 TAGO_SERVICE_KEY 재사용. 서울시 API 권한 필요 |
| `TAGO_SERVICE_KEY` | 버스 키 fallback 및 TAGO 키 |
| `SEOUL_SUBWAY_REALTIME_KEY` | 기존 서울시 지하철 키 |
| `TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED` | 운영/Preview에서 TAGO도 조회하려면 `true`. 서울시 조회만을 위해 켤 필요 없음 |
| `SEOUL_BUS_API_LOCAL_ENABLED`, `SEOUL_SUBWAY_REALTIME_LOCAL_ENABLED` | 더 이상 사용하지 않음. 코드·예제·로컬에서 제거 |

기존 비밀키 값은 삭제·변경·출력하지 않았다. Vercel 설정은 직접 수정하지 않았고 배포도 하지 않았다.

## 배포 후 수동 검증

1. 사용자 승인 후 새 Preview를 만들고 허용 사용자로 로그인한다. 기존 지도 SDK 도메인/Supabase 로그인 설정은 그대로 확인한다.
2. `/api/kakao/seoul-bus-evidence`가 503 운영 차단 대신 실제 API 결과 또는 원인별 오류를 반환하는지 확인한다. 응답/스크린샷에 키·JWT·좌표를 노출하지 않는다.
3. 검증된 첫 버스 승차 위치·방향과 첫째/둘째 도착정보, 출발대기·도착정보 없음 처리를 확인한다.
4. 지하철 첫 승차의 노선·방향·행선지·시간 보정과 도착정보 없음 상태를 확인한다.
5. 3개 카드·더보기·선택 상세·지도, G8 단일/양쪽 성공 시 ETA, 스냅 실패 참고선을 확인한다.
6. 외부 API 실패 시 기본 경로·참고 도보·부분 ETA가 가능한 범위에서 유지되는지 확인한다.
7. 실제 iPhone Safari에서 안내 시작→도착/수동 종료→로컬 저장→서버 동기화를 구분해 확인한다. 참고 좌표만 있는 경로는 자동 종료가 비활성화돼야 한다.

이번 작업에서는 실제 API 호출 횟수/한도를 추가 확인하지 않았으므로 외부 서울시 API를 요청하지 않았다. 모든 환경별 성공 검증은 Mock이며, 실제 Vercel 네트워크 도달·키 권한·실시간 응답은 미검증이다.

## 최종 로컬 검증 결과

- TypeScript·ESLint 통과.
- 전체 Vitest: **87개 파일, 514개 테스트 통과**. 이전 G8 참고 도보/부분 ETA, 3개 카드·더보기, GPS 자동 저장 테스트 포함.
- Production build 통과. 기존 프런트엔드 500KB 초과 번들 경고는 남는다.
- 서버 함수 **6/12개**, 엄격한 NodeNext 컴파일·실제 Node ESM import 및 메서드 가드 검사 통과.
- 개발/Preview/Production의 서울시 버스 증거·도착정보·지하철 도착정보 Mock 호출, 인증/키 누락, 오류·타임아웃·한도, 캐시·진행 중 요청 공유를 검증했다.
- 실제 API 호출, commit, push, merge, Preview/Production 배포는 실행하지 않았다.
