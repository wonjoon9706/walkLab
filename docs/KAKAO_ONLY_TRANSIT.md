# 카카오 대중교통 단일화

2026-11-05 현재 작업 트리 기준 구현이다. 기존 운영 배포 `f6a77b4`는 변경하지 않았다.
기존 미커밋 Production 활성화·HTTPS 제한·오류 안내 변경 위에서 작업했으며 reset/restore/clean/commit/push/merge/배포는 실행하지 않았다.

## 제거 파일 및 이유

| 파일 | 제거 이유 |
| --- | --- |
| `api/tmap/transit-routes.ts` | 이전 공급자 유료 경로 API |
| `server/tmap/transit-routes.test.ts` | 삭제 API 전용 테스트 |
| `src/services/routing/tmapTransitRouteParser.ts` 및 `.test.ts` | 이전 공급자 응답 전용 파서·테스트 |
| `src/services/routing/transitRouteClient.ts` 및 `.test.ts` | 이전 공급자 경로 API 클라이언트·테스트 |
| `src/features/transit/transitRoutePresentation.ts` 및 `.test.ts` | 이전 공급자 노선 색상·라벨 전용 UI 유틸·테스트 |
| `src/services/routing/transitRouteDiagnostics.ts` 및 `.test.ts` | 이전 공급자 마지막 WALK 진단·테스트 |
| `src/services/routing/transitEta.ts` 및 `.test.ts` | 삭제한 공급자 UI에서만 사용하던 ETA·구간 합계 진단. 카카오 ETA는 기존 전용 모듈 사용 |

총 12개 파일을 삭제했다. `TransitRoutePanel.tsx`는 삭제 대신 기존 카카오 패널을 그대로 내보내도록 단순화했다.
해당 테스트도 환경별 카카오 단일 UI 테스트로 교체했다. 카카오 UI/파서는 재구현하지 않았다.

## 공용 모델 및 보존 기능

- `TransitItinerary`와 `TransitRouteLeg`는 카카오 어댑터·지도·T2-3/T2-4A가 사용하므로 유지한다. 전용 `TransitRouteResult`와 이전 ETA 모델만 제거했다.
- 숫자형 노선유형 매핑과 이전 공급자의 지하철 요청 생성기를 제거했다. 서울시 지하철은 기존 카카오 노선명 매핑·다음역·하차역·일반/급행 검증을 유지한다.
- 공급자별 숫자형 `routeType`은 공통 경로/버스·지하철 요청에서 제거했다. 서울시/TAGO **원본 문자열** 버스유형 필드는 실제 공급자 데이터라 유지한다.
- 공유 TAGO 매칭은 `matchBusStopToTago`로 명칭만 변경했다. 120m·이름·노선·방향 기준은 유지한다.
- 공통 버스 요청의 `tmapStopId`는 `providerStopId`, 진단의 `tmap`은 `route`로 변경했다. 내부 기록의 `tmapDurationSeconds`는 `providerDurationSeconds`로 변경했으며 시간 계산식은 그대로다. 요청 생성기·파서·테스트를 함께 갱신했다.
- 서버와 지하철 클라이언트의 캐시는 숫자형 노선 대신 노선명을 포함한다. 같은 역의 다른 노선·방향 결과를 섞지 않는다.
- 보행 기록 원본/IndexedDB/DB 스키마/동기화/G6/G7 알고리즘은 변경하지 않았다. 40m·정확도 30m·새 GPS 3회·위치 도약 및 중복 방어는 유지한다.
- 우선 3개/더보기, G7/G8 ETA, 지도, 비동기 무효화·캐시, 탑승 가능성 계산과 첫 승차 기록 기능은 기존 카카오 모듈을 사용한다.
- 이전 공급자의 독립 npm 패키지는 없어 의존성·잠금파일 삭제는 필요 없다.

## 설정 이전

| 설정 | 현재 처리 |
| --- | --- |
| `KAKAO_TRANSIT_PRODUCTION_ENABLED=true` | Production/Preview의 카카오 경로·출입구 API 허용. 별도로 JWT·허용 UUID 검증 필요 |
| `TRANSIT_ALLOWED_USER_ID` | 새 허용 사용자 설정. 기존 `TMAP_TRANSIT_ALLOWED_USER_ID`의 UUID를 그대로 옮김 |
| `KAKAO_REST_API_KEY` | 기존 서버 키 유지 |
| 기존 Supabase 공개·서버 설정 / `VITE_KAKAO_MAP_JS_KEY` | 유지 |
| `TAGO_SERVICE_KEY`, `TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED`, `TAGO_BUS_ARRIVAL_DIAGNOSTICS_ENABLED` | 기존 TAGO 정책 유지 |
| 서울시 버스·지하철 키와 `*_LOCAL_ENABLED` | 유지. 운영 HTTP 제한을 해제하지 않음 |
| `TMAP_TRANSIT_APP_KEY`, `TMAP_TRANSIT_PRODUCTION_ENABLED`, `VITE_TRANSIT_PROVIDER` | 코드·타입·예제·로컬 설정에서 제거 |

로컬에서는 UUID 값만 새 이름으로 옮겼고 다른 서비스 비밀키는 변경하지 않았다. 키·UUID 값은 출력하지 않았다.
Vercel 환경변수는 수정하지 않았다. 새 Preview/Production 배포 전에 `TRANSIT_ALLOWED_USER_ID`와 카카오 운영 플래그를 등록해야 한다.
현재 정상 배포는 구변수를 사용하므로 **구배포 보존과 롤백 가능성을 위해 Vercel의 기존 설정은 새 배포 검증 전 삭제하지 않는다.**
누락된 허용 UUID를 기본값으로 대체하거나 사용자 제한을 생략하지 않는다. 누락 시 503 설정 오류로 닫는다.

## 운영 제한

카카오 HTTPS 검색과 서울시 HTTP 실시간/정류장 검증은 별개다. 안전한 서울시 운영 통신 미확인으로 Production/Preview 차단을 유지했다.
실시간 실패가 기본 경로 목록을 막지 않으며 임의 ETA·좌표를 생성하지 않는다. 검증된 첫 승차 좌표가 없으면 자동 도착 감지를 끄고 수동 종료를 안내한다.
API 진입점은 6개이고 `npm run check:server`가 함수 수, 엄격한 NodeNext 출력, Node ESM 로드 및 405 가드를 검증한다.

## 검증 및 배포 전 확인

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --maxWorkers=2
npm.cmd run build
```

전용 공급자 테스트 제거로 전체 테스트 수는 감소한다. 카카오 목록·더보기·ETA·실시간·보행 자동 저장의 기존 테스트는 유지한다.
최종 검증: TypeScript·ESLint·diff 공백 검사 통과, Vitest 86개 파일 **483개 테스트 통과**, Production 빌드 통과, 서버 **6/12개**의 NodeNext 출력·실제 Node ESM 로드 검사 통과.
개발/Production 조건의 실제 카카오 패널에서 3개 카드·12개 더보기·선택 계산 캐시 테스트를 모두 실행했다. 기존 500KB 초과 번들 경고는 남는다.
실제 외부 API를 호출하지 않았으며 Preview/Production 로그인·실측 API·iPhone GPS는 미검증이다.
사용자 승인 후 [운영 전환 절차](KAKAO_PRODUCTION_ENABLEMENT.md)에 따라 Preview에서 3개 카드/더보기, 상세 지도, 오류 시 목록 유지, 보행 저장을 확인한다.
Preview/Production 지도 도메인 등록 및 Supabase 로그인 설정도 확인한다.

실행 코드·활성 타입·환경변수 예제에서 이전 공급자 참조를 검사한다. 과거 게이트 명세와 진단 문서는 개발 이력으로 보존하며, 과거 공급자 설명은 현재 운영 정책이 아니다.
