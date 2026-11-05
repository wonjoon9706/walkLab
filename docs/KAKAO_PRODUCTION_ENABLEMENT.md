# 카카오 대중교통 개발·운영 전환

## 설정

| 변수 | 카카오 사용 값 | 범위 |
| --- | --- | --- |
| `KAKAO_TRANSIT_PRODUCTION_ENABLED` | `true` | 서버의 Production 및 Preview 카카오 검색·출입구 검색 허용. 그 외 값은 차단 |
| `KAKAO_REST_API_KEY` | 기존 서버 비밀값 | 카카오 검색, 출입구 검색, 기존 G8 도보 라우팅 |
| `TRANSIT_ALLOWED_USER_ID` | 기존 허용 사용자 UUID | 기존 사용자 접근 제한 유지. 기존 UUID를 새 변수명에 그대로 등록 |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | 기존 프로젝트 설정 | 서버 JWT 검증. 기존 공개 Supabase 설정 fallback도 유지 |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_KAKAO_MAP_JS_KEY` | 기존 공개 설정 | 클라이언트 로그인·지도 |

대중교통 UI는 모든 환경에서 카카오 하나를 사용한다. 공개 공급자 선택 설정은 제거했다. 서버 플래그와 사용자 인증 없이는 운영 외부 API를 호출할 수 없다.
로컬 개발은 서버 플래그 없이 기존처럼 허용한다. `VERCEL_ENV=production/preview` 또는 `NODE_ENV=production`은 명시적 서버 플래그가 필요하다.
`NODE_ENV`, `DEV`, `PROD`, `VERCEL_ENV` 값을 위조해 차단을 우회하지 않는다.

로컬 `.env.local`은 기존 허용 사용자 UUID를 `TRANSIT_ALLOWED_USER_ID`로 옮겼다. 사용하지 않는 공급자 선택과 이전 경로 공급자의 설정만 제거했으며 카카오·서울시·Supabase 비밀키는 변경하지 않았다.
`.env.example`의 서버 플래그 기본값은 `false`다. Vite 환경변수 변경 후에는 개발 서버 재시작 또는 새 빌드가 필요하다.

## 활성화 범위 및 남은 제한

- 카카오 원본 목록, 우선 3개 후보·더보기, 상세 지도·타임라인을 같은 UI로 제공한다.
- HTTPS 카카오 경로·출입구 검색과 기존 G8/G7 계산 모듈을 재사용한다. 전체 ETA 계산식은 변경하지 않는다.
- 보행 기록·IndexedDB·Supabase 동기화 기능은 유지한다. 유효한 첫 승차 위치를 확인한 경우에만 기존 자동 도착 감지를 사용한다.
- 서울시 버스 정류장·노선 검증과 버스·지하철 실시간은 Production/Preview에서 계속 제한한다. 로컬 플래그나 카카오 운영 플래그로 이 제한은 열리지 않는다.
- 따라서 버스를 포함한 경로의 승하차 G8, 개인화 시간 및 자동 도착 목표를 운영에서 확보하지 못할 수 있다. 임의 좌표·시간·매칭으로 대체하지 않는다. 수동 기록 종료 기능은 유지한다.
- 비서울 TAGO의 기존 운영 플래그·접근 제한은 유지한다. 이전 경로 공급자의 API를 제거해 함수는 6개다. 상세 제거 내역은 [단일화 작업 문서](KAKAO_ONLY_TRANSIT.md)를 참조한다.

## 서울시 통신 조사

현재 구현 주소는 버스 `http://ws.bus.go.kr/api/rest`, 지하철 `http://swopenAPI.seoul.go.kr/api/subway`다.
공식 버스 서비스 안내는 HTTP 요청 주소를 제시하며, 확인한 공식 자료에서는 해당 기능의 검증된 HTTPS 대체 주소를 확보하지 못했다.
지하철 공식 데이터셋도 확인했으나 이 환경에서 HTTPS 실사용을 확인할 수 없었다.

2026-11-05 로컬 진단에서는 인증키·사용자 좌표 없이 두 호스트의 HTTPS 루트에 각각 HEAD 요청을 1회 수행했다.
둘 다 기본 인증서 검증을 유지한 상태로 5초 타임아웃이었다. HTTPS 미지원의 증명은 아니며, API 경로의 정상 응답이나 Vercel 연결 성공을 의미하지 않는다.
실제 키가 포함된 서울시 도착정보 요청은 수행하지 않았다.

서버에서 HTTP를 호출하는 것은 브라우저 mixed content 문제와 별개지만, 인증키와 응답이 전송 중 보호되지 않는다.
안전한 운영 방법이 확인될 때까지 운영 HTTP를 허용하지 않는다. 인증서 검증 비활성화, 공개 프록시, HTTP 자동 fallback은 추가하지 않았다.
후속 작업은 제공기관에 공식 TLS 엔드포인트를 확인한 뒤 실제 API 경로·인증서·응답을 검증하는 것이다.

출처:
- [서울시 지하철 실시간 도착정보](https://data.seoul.go.kr/dataList/OA-12764/A/1/datasetView.do)
- [서울특별시 정류소정보조회](https://www.data.go.kr/data/15000303/openapi.do)
- [서울시 버스 서비스 안내](https://data.seoul.go.kr/dataList/OA-15340/L/1/datasetView.do)

## 로컬 및 Preview 검증 절차

1. 로컬 `.env.local`의 `TRANSIT_ALLOWED_USER_ID`가 기존 허용 사용자 UUID인지 확인하고 `vercel dev`를 재시작한다. 공급자 선택 설정은 필요 없다.
2. 허용된 사용자로 로그인하고 출발·목적지를 확정한다. 3개 카드가 먼저 표시되고 더보기/접기에서 재검색하지 않는지 확인한다.
3. 상세 진입 후 G7/G8 결과·지도·실시간 및 안내 시작/종료를 기존 방식으로 확인한다. 로컬 서울시 API는 기존 로컬 플래그와 키가 필요하다.
4. 사용자 승인 후에만 Vercel의 **Preview 환경**에 서버 플래그 `true`, `TRANSIT_ALLOWED_USER_ID`, 기존 키/인증 변수를 설정하고 Preview를 새로 빌드한다. Production은 별도 환경이므로 따로 설정해야 한다. 현재 운영 중인 구버전 배포를 위해 기존 환경변수는 새 배포 검증 전까지 Vercel에서 삭제하지 않는다.
5. 카카오 앱의 JavaScript 키 설정에서 실제 Preview HTTPS 도메인과 Production 도메인을 SDK 허용 도메인에 등록한다. Preview 주소가 바뀌면 새 주소도 확인한다. [공식 지도 Web 가이드](https://apis.map.kakao.com/web/guide/)
6. Supabase 로그인 이메일이 다른 사이트로 이동한다면 기존 Auth Site URL/Redirect URL 설정을 확인한다. Preview 도메인에서는 별도로 로그인한다.
7. Preview Network에서 `/api/kakao/transit-routes`와 `/api/kakao/subway-entrances`의 성공을 확인한다. 401은 로그인, 403은 허용 UUID, 503은 서버 활성화/설정, 429는 제공기관 한도를 확인한다. 키·JWT·위치를 로그로 공유하지 않는다.
8. 운영 서울시 기능은 명확한 제한 안내가 나오고, 가짜 도착시간이나 불확실한 탑승 판정이 표시되지 않아야 한다. 제한 상태에서 목록·더보기·상세는 계속 사용할 수 있어야 한다.
9. 첫 승차 자동 기록은 목표 좌표가 검증된 경로에서 실제 iPhone Safari 전경 상태로 테스트한다. 도착 시 로컬 저장과 서버 동기화 완료를 구분한다. 확인되지 않은 목표에서는 수동 종료한다.
10. Preview 검증 후 사용자 승인으로 Production을 진행한다. VITE 값 변경은 기존 배포에 즉시 반영되지 않아 재빌드가 필요하다.

자동 테스트는 실제 API/실기기 성공을 뜻하지 않는다. 이번 작업에서는 Preview 배포·실제 카카오 경로 요청·iPhone GPS 검증을 수행하지 않았다.

## 이번 로컬 검증 결과

- TypeScript, ESLint 통과.
- 전체 테스트 수와 단일 카카오 UI 회귀 결과는 [단일화 작업 문서](KAKAO_ONLY_TRANSIT.md)를 참조한다. 이전 공급자 전용 테스트는 제거했다.
- 서버 6/12개, 엄격한 NodeNext 출력 및 실제 Node ESM import 검사를 수행한다.
- 기존 프런트엔드 500KB 초과 번들 경고는 남는다.
- 실제 브라우저 로그인·검색 및 클라우드 외부 API 성공은 미검증이다. 위 Preview 절차로 별도 확인해야 한다.
