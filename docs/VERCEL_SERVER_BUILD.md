# Vercel 서버 빌드 점검

## 함수 구성

기존 `api`에는 엔드포인트 7개, 보조 모듈 9개, 테스트 15개로 총 31개의 TypeScript 파일이 있었다.
Vercel은 `api`의 지원 소스 파일을 함수 진입점으로 수집하므로 보조 코드와 테스트는 `server`로 이동했다.
이후 카카오 단일화로 이전 경로 공급자 엔드포인트 1개를 삭제했다. 현재 배포 함수는 아래 6개다.

| 유지한 경로 | 용도 |
| --- | --- |
| `/api/kakao/walking-route` | G8 도보 경로 |
| `/api/kakao/transit-routes` | 명시적 운영 플래그를 사용하는 카카오 대중교통 |
| `/api/kakao/subway-entrances` | 명시적 운영 플래그를 사용하는 출입구 후보 조회 |
| `/api/kakao/seoul-bus-evidence` | 로컬 버스 정류장·노선 검증 |
| `/api/tago/bus-arrival` | TAGO 및 서울시 버스 도착정보 |
| `/api/subway/arrival` | 서울시 지하철 도착정보 |

함수는 6개로, 이번 배포에서 보고된 Hobby 12개 제한 이내다. 유지한 API URL은 동일하며 추가 rewrite는 필요하지 않다.

## 타입 및 ESM 설정

- Vercel의 Node 빌더는 프로젝트 참조를 지원하지 않는다. 기존 루트 `tsconfig.json`은 참조만 선언해 Node 타입과 서버 옵션을 제공하지 않았다.
- 루트 설정이 `tsconfig.api.json`을 상속하도록 변경했다. 기존 앱·Vite 프로젝트 참조도 유지한다.
- 서버 설정은 `types: ["node"]`, `strict: true`, `module/moduleResolution: NodeNext`를 사용한다. `@types/node`는 이미 설치·잠금파일에 선언돼 있어 의존성 추가는 필요 없다.
- `RequestWithBody`가 상속하는 `IncomingMessage`와 `process`, `Buffer`는 Node 타입으로 검사한다. 타입 검사 생략이나 `any` 우회는 추가하지 않았다.
- 서버가 참조하는 공용 도메인·파서 그래프의 상대 import를 출력 파일 기준 `.js`로 맞췄다. 계산 로직은 변경하지 않았다.
- 이전 배포의 상세 45개 오류 로그는 로컬에 없어 항목별 동일 재현은 하지 못했다. 현재 소스 전체 검사 및 실제 서버 출력물 로드로 수정 상태를 검증했다.

## 로컬 검증

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --maxWorkers=2
npm.cmd run build
```

`build`는 `check:server`도 실행한다. 이 검사는 다음을 확인한다.

1. `api` 파일이 지정된 6개인지 확인하고 12개 제한을 검사한다.
2. 서버와 공용 의존성을 NodeNext 모드로 검사하고 임시 JavaScript를 출력한다.
3. Production 환경에서 실제 Node ESM으로 6개 핸들러를 import한다.
4. 인증·외부 API 요청 없이 OPTIONS의 405 메서드 가드를 확인한다.
5. `.vercel/server-check-*` 안에 직접 만든 출력물만 정리한다.

최신 로컬 검증 수치는 [카카오 단일화 문서](KAKAO_ONLY_TRANSIT.md)를 참조한다.
기존 500KB 초과 프런트엔드 번들 경고는 남는다.

## 운영 검증 경계

실제 Vercel 원격 빌드·배포는 수행하지 않았다. 클라우드 Node 버전, 환경변수, 프로젝트별 빌드 설정은 배포 단계에서 별도 확인해야 한다.
이 빌드 수정 당시에는 카카오 localhost 제한을 유지했다. 이후 명시적 운영 플래그 정책은 [카카오 운영 전환 문서](KAKAO_PRODUCTION_ENABLEMENT.md)를 따른다. 서울시 HTTP 운영 차단, JWT·허용 사용자·호출량 제한은 유지한다.
배포 성공이 해당 로컬 전용 기능의 Production 사용 허가를 의미하지 않는다.

기존 미커밋 보행 자동 기록 변경사항은 보존했으며 commit·push·배포하지 않았다.

참고: [Vercel Node.js Runtime](https://vercel.com/docs/functions/runtimes/node-js)
