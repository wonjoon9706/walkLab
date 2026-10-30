# WalkLab MVP Implementation Plan

- 문서 상태: 구현 계획 초안
- 작성일: 2026-10-29
- 최신 현황 반영: 2026-10-30
- 기준 문서: `MVP.md`, `PRD.md`, `SPEC.md`
- 대상 범위: 첫 번째 WalkLab MVP P0 48개
- 목표 기간: 1인 개발 7일

## 1. 계획의 목적

이 문서는 이메일 OTP로 로그인한 사용자가 iPhone Safari에서 GPS 측정을 수동으로 시작·종료하고, 모든 원본 위치 콜백을 IndexedDB에 먼저 저장한 뒤 Supabase에 자동 동기화하며, 지도에서 원본과 품질 적용 경로를 검증하는 첫 MVP의 구현 순서와 완료 기준을 정의한다.

7일은 목표 일정이지 보안·원본 무결성·RLS 검증을 생략하는 근거가 아니다. 일정이 부족하면 P0을 불완전하게 공개하지 않고 미완료 게이트를 명시해 일정을 연장한다.

## 2. 범위와 구현 원칙

### 2.1 반드시 지킬 원칙

- 이메일 OTP 인증 성공 전에는 측정·기록 화면에 접근할 수 없다.
- 새 세션은 생성 시점의 Supabase user ID를 소유자로 고정한다.
- GPS 원본은 IndexedDB transaction 성공 후에만 동기화 대상으로 삼는다.
- 원본 GPS와 품질·metrics·동기화 상태를 분리한다.
- 다른 사용자 소유 데이터는 화면에 표시하거나 서버로 전송하지 않는다.
- 서버 저장을 확인하기 전에는 동기화 완료로 처리하지 않는다.
- Publishable Key만 브라우저에 두고 Secret·Service Role·관리자 자격 증명은 포함하지 않는다.
- `persistSession: true` 동작을 위해 Supabase SDK가 access token과 refresh token을 SDK 관리 로컬 저장소에 보관하는 것은 허용한다.
- 애플리케이션 코드는 인증 토큰을 별도 key로 직접 저장·복제하지 않고, OTP 원문과 인증 토큰을 console·오류 이벤트·진단 UI에 출력하지 않는다.
- 자동 테스트와 실제 iPhone Safari 검증을 각 게이트의 완료 조건으로 사용한다.

### 2.2 이번 계획에서 제외

- P1 `OPT-001~011`
- 개인화 도보 ETA, Smart Arrival, 경로 탐색, 대중교통과 신호등 연동
- 자동 걷기 감지·자동 시작·자동 종료
- Service Worker, PWA 오프라인 실행과 백그라운드 GPS·동기화
- 사용자용 삭제 UI와 관리자 대시보드
- FastAPI와 별도 애플리케이션 서버

FastAPI는 현재 GPS 수집 MVP에 추가하지 않는다. 향후 Python 기반 개인화 ETA 모델을 서비스하거나 외부 대중교통 API의 비밀 키·서버 측 조합이 필요해질 때 도입 여부를 별도 검토한다.

## 3. 개발 운영 방식

### 3.1 Git과 작업 단위

구현 시작 시 다음 원칙으로 저장소를 준비한다.

1. Git 저장소가 없으면 초기화한다.
2. 기본 branch를 `main`으로 정한다.
3. `.gitignore`에 `node_modules`, `dist`, Supabase 임시 파일과 테스트 산출물을 등록하고 환경 파일에는 아래 순서의 예외 규칙을 사용한다.

   ```gitignore
   .env*
   !.env.example
   ```

   `.env.example`에는 실제 값 없이 변수 이름과 설명만 두고 Git에 포함한다.
4. 문서 기준점을 첫 commit으로 남긴다.
5. 아래 단계 또는 의미 있는 작업 단위별로 작은 commit을 만든다.
6. 실제 key·OTP·token·사용자 이메일·GPS 좌표 fixture를 commit하지 않는다.

1인 개발이므로 장기 feature branch 운영은 필수가 아니다. 다만 RLS·삭제 trigger처럼 되돌리기 어려운 변경은 별도 commit으로 분리해 검토 가능하게 한다.

### 3.2 품질 명령 기준

프로젝트 구성 후 모든 게이트에서 다음 명령을 통과시키는 것을 기본으로 한다.

- TypeScript type check
- ESLint
- Vitest
- production build
- Supabase local DB test와 pgTAP은 DB 단계부터 추가

정확한 package script 이름은 프로젝트 생성 시 확정하되 `typecheck`, `lint`, `test`, `build`, `test:db`처럼 역할을 명확히 구분한다.

### 3.3 비밀정보와 환경 분리

- 로컬·preview·production 환경을 분리한다.
- `.env.example`에는 변수 이름만 기록한다.
- 브라우저 변수는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_KAKAO_MAP_JS_KEY`와 `VITE_EMAIL_OTP_LENGTH`로 제한한다.
- Supabase SDK가 세션 복원을 위해 관리하는 access·refresh token 저장은 허용하되, 애플리케이션 소유 storage key나 IndexedDB store에 토큰을 복제하지 않는다.
- 관리자 삭제 작업은 Supabase Dashboard 또는 신뢰할 수 있는 관리자 SQL 환경에서만 수행한다.

## 4. 단계 의존성과 7일 배치

> 이 절의 G0~G7은 **첫 P0를 7일에 구현하기 위해 작성한 초기 MVP 게이트 이름**이다. 이후 제품 개발에서 사용한 G6 이동·정지 분석과 G7 개인 보행속도 학습 단계와 이름이 겹치지만, 기존 계획과 추적성을 보존하기 위해 아래 게이트 명칭을 변경하지 않는다.

| 게이트 | 목표 | 선행 조건 | 목표일 | 난이도 |
|---|---|---|---|---|
| G0 | 저장소·도구·외부 서비스 준비 | 문서 확정 | 1일차 오전 | 낮음 |
| G1 | 이메일 OTP와 보호 라우트 | G0 | 1일차 오후 | 중간 |
| G2 | IndexedDB 우선 GPS 수집 수직 슬라이스 | G1 | 2일차 | 높음 |
| G3 | PostgreSQL 계약·RLS·보안 검증 | G2 도메인 타입 | 3일차 | 높음 |
| G4 | 자동 동기화·부분 실패 복구 | G2, G3 | 4일차 | 매우 높음 |
| G5 | 품질 계산·기록 목록·상세 | G2, G4 | 5일차 | 중간 |
| G6 | 지도·삭제 재업로드 방어 검증 | G3~G5 | 6일차 | 높음 |
| G7 | 배포·전체 회귀·실보행 판정 | G0~G6 | 7일차 | 높음 |

같은 날 작업이 끝나지 않으면 다음 게이트의 핵심 구현을 먼저 진행하지 않는다. 단위 테스트 fixture 준비나 문서 보완처럼 현재 게이트를 침범하지 않는 준비 작업만 병행한다.

## 5. G0 — 저장소, 개발 환경과 외부 서비스 준비

### 관련 요구사항

직접 구현하는 P0 ID는 없지만 모든 요구사항의 선행 작업이며 `SEC-004`, `AUTH-002~005`, `MAP-001~005` 검증 환경을 준비한다.

### 작업 목록

- Git 초기화·기준 문서 commit·비밀정보 제외 규칙 설정
- Node.js 22.12 이상 확인 및 버전 고정 파일 결정
- React + Vite + TypeScript 프로젝트, React Router, Dexie와 Supabase JS 설치 계획 반영
- Vitest, fake-indexeddb, ESLint와 type check 구성
- `SPEC.md`의 폴더 구조와 네 개 route shell 준비 계획
- Supabase 프로젝트 생성 및 URL·Publishable Key 확보 계획
- Supabase CLI 연결과 local project 초기화 계획
- Email provider 활성화, Site URL과 허용 URL 확인 계획
- `Magic Link or OTP` 템플릿에서 `{{ .Token }}` 사용 및 `{{ .ConfirmationURL }}` 제거 계획
- OTP 6자리, 만료 3,600초, 재요청·발송 제한의 실제 project 값 확인 계획
- 초기 본인 테스트 이메일이 기본 발송 정책에서 허용되는지 확인
- 카카오디벨로퍼스 앱·JavaScript 키와 production SDK 도메인 등록 계획
- Vercel project, build output `dist`, SPA rewrite와 환경변수 등록 계획

이번 `PLAN.md` 작성 작업에서는 실제 프로젝트 생성, package 설치, Dashboard 설정 또는 배포를 수행하지 않았다. 위 항목은 G0 구현 착수 시 실행할 체크리스트다.

### 자동 검증

- 빈 앱 기준 typecheck·lint·test·build가 성공해야 한다.
- 환경변수 schema test에서 누락·형식 오류를 명확히 보고해야 한다.
- 저장소 secret scan에서 Secret Key·Service Role Key·실제 OTP가 검출되지 않아야 한다.

### iPhone Safari 검증

- HTTPS preview URL이 Safari에서 열리고 네 route shell이 렌더링되는지만 확인한다.
- 아직 위치 권한 요청이 발생하지 않아야 한다.

### 완료 체크리스트

- [ ] Git 기준점과 `.gitignore`, `.env.example`이 준비됐다.
- [ ] 개발·테스트·build 명령이 모두 성공한다.
- [ ] 실제 Supabase OTP 자릿수·만료·발송 제한을 기록했다.
- [ ] 이메일 템플릿이 링크가 아닌 OTP 발송 형태인지 확인했다.
- [ ] 브라우저 허용 key와 금지 key 목록을 확인했다.
- [ ] 카카오맵과 Vercel 설정값을 안전하게 주입할 경로가 정해졌다.

### 실패 시 대응

- OTP 설정을 확인할 수 없으면 G1의 UI 길이를 확정하지 않고 6~10자리 입력을 임시 허용하되 배포 게이트를 통과시키지 않는다.
- 기본 이메일 발송 제한으로 반복 테스트가 불가능하면 요청 간격을 지키며 본인 계정 테스트를 최소화한다. custom SMTP는 별도 필요사항으로 기록하되 P0에 임의 추가하지 않는다.
- HTTPS preview가 없으면 GPS 실기기 검증을 진행하지 않는다.

## 6. G1 — 이메일 OTP 인증과 접근 제어

### 관련 요구사항

`AUTH-001~007`, `SEC-002`, `SEC-004`

### 작업 목록

#### T1.1 AuthService와 인증 상태

- Supabase client에 `persistSession`과 `autoRefreshToken` 적용
- `signInWithOtp({ shouldCreateUser: true })` 발송
- `verifyOtp({ email, token, type: 'email' })` 검증
- `getSession`, `getUser`, `onAuthStateChange`, `signOut` 연결
- initializing, signed_out, otp_requested, verifying, authenticated, expired, error 상태 구현

완료 조건: 신규·기존 이메일 로그인, 세션 복원과 로그아웃이 정의된 상태 전이대로 동작한다.

#### T1.2 로그인 화면과 OTP 보안

- 이메일 입력, OTP 입력, 60초 재요청 UI와 오류 매핑
- OTP는 React 메모리에만 두고 검증 후 즉시 제거
- OTP 원문은 URL·localStorage·sessionStorage·IndexedDB에 저장하지 않음
- access token과 refresh token은 `persistSession: true`에 따른 Supabase SDK 관리 저장만 허용
- 애플리케이션 코드에서 토큰을 직접 저장·복제하지 않고 console·오류 이벤트·진단 UI에 OTP·토큰을 출력하지 않음

완료 조건: 잘못된 코드·만료·발송 제한·네트워크 실패가 구분되고, OTP는 영구 저장되지 않으며 인증 토큰은 SDK 관리 세션 저장 외에 복제·출력되지 않는다.

#### T1.3 보호 route와 로그아웃 guard

- `/`, `/history`, `/sessions/:sessionId`에 인증 guard 적용
- auth 초기화 중 보호 화면 선렌더링 방지
- 측정 상태를 받을 수 있는 로그아웃 guard 자리 마련

완료 조건: 비로그인 직접 URL 접근이 `/login`으로 이동하고 GPS API를 호출하지 않는다.

### 자동 검증

- AuthService 성공·실패 응답과 상태 전이 unit test
- 신규 사용자의 `shouldCreateUser: true` 호출 검증
- `type: 'email'` 검증 호출 test
- route guard와 세션 복원 component test
- OTP 원문이 browser 영구 storage와 logger에 전달되지 않는 test
- session 복원에 필요한 SDK 관리 token 저장은 존재하고, 애플리케이션 자체 storage key·DB·logger에는 token 복제본이 없는 test

### iPhone Safari 검증

- SPEC `IOS-01~04`: 신규 OTP, 잘못된·만료 코드, 세션 복원, 로그아웃, 보호 URL 직접 접근
- 이메일 입력 시 자동 완성, OTP 입력 시 숫자 키패드와 `one-time-code` 동작 확인
- 앱 진입만으로 위치 권한 창이 나타나지 않는지 확인

### 다음 단계 진입 체크리스트

- [ ] 신규 이메일 OTP 로그인과 자동 계정 생성이 성공한다.
- [ ] 새로고침 후 유효 세션이 복원된다.
- [ ] 로그아웃 후 모든 보호 route가 차단된다.
- [ ] 잘못된·만료 OTP와 제한 오류가 구분된다.
- [ ] OTP 원문이 영구 저장소와 로그에 남지 않는다.
- [ ] SDK 관리 세션 저장 외에 access·refresh token 복제본이 없고 token이 로그·진단 UI에 노출되지 않는다.
- [ ] 브라우저 bundle에 금지 key가 없다.

### 실패 시 대응

- OTP 이메일이 링크로 오면 UI 구현을 우회하지 말고 Supabase template의 `{{ .Token }}`과 `{{ .ConfirmationURL }}`부터 수정한다.
- 세션 복원이 불안정하면 GPS 구현으로 넘어가지 않고 auth event 순서와 client 중복 생성을 먼저 고친다.
- 실기기에서 OTP 자동 완성이 안 되어도 수동 입력이 가능하면 차단 이슈는 아니지만 결과를 기록한다.

## 7. G2 — IndexedDB 우선 GPS 수집 수직 슬라이스

### 관련 요구사항

`REC-001~008`, `LOC-001~003`, `LOC-005`, `SEC-003`, `DATA-002~003`

### 작업 목록

#### T2.1 도메인 타입과 Dexie schema

- session, raw point, event, quality, metrics, sync item, cutoff 타입 정의
- Dexie schema version 1과 SPEC의 8개 store·index 정의
- installation ID·schema/app version 생성
- session+sync item, point+sync item 원자 transaction 구현
- raw store는 `add`만 사용하고 수정 API를 노출하지 않음

완료 조건: 중복 ID는 덮어쓰지 않고 실패하며 point와 pending sync item이 함께 성공하거나 함께 실패한다.

#### T2.2 사용자별 LocalRepository

- 모든 목록·상세 query에 current user ID를 필수 입력으로 요구
- owner 생성 후 변경 guard
- 로그아웃·owner 불일치 시 결과 반환 금지
- 앱 시작 시 recording session을 interrupted로 복구

완료 조건: 사용자 A 상태에서 B의 로컬 세션이 조회되지 않고 owner 변경이 실패한다.

#### T2.3 GpsCollector와 수동 측정 상태

- 시작 직전 authenticated user, `getUser()`, online, Geolocation, active session 여부 확인
- 사용자 버튼에서만 session 생성과 `watchPosition()` 호출
- 모든 callback에 received_at, measured_at, sequence와 UUID 부여
- GPS 선택 필드의 null 보존과 원본 무변형 저장
- session별 Promise chain으로 callback 순서 보존
- 권한·unavailable·timeout을 point가 아닌 event로 저장
- 사용자 종료에서만 clearWatch, 마지막 저장 대기, ended_at과 completed 기록
- 새로고침 후 자동 재시작 금지

완료 조건: 정상 callback마다 raw point 또는 관측 가능한 저장 실패가 존재하고, 첫 GPS 전 오류도 session event로 남는다.

#### T2.4 측정 홈 최소 상태 표시

- idle, starting, recording, completed, interrupted, error
- 경과 시간, 저장 성공 point 수, GPS·local 저장·network 상태
- 전면 유지 및 IndexedDB 손실 가능성 안내
- 측정 중 로그아웃 요청은 종료 안내만 표시

완료 조건: server sync 없이도 한 세션을 수동 시작·종료하고 IndexedDB에서 원본과 이벤트를 확인할 수 있다.

### 자동 검증

- fake-indexeddb로 schema, transaction 원자성, 중복 ID와 owner 불변 test
- 가짜 Geolocation callback으로 순서·시각·null·UUID·전체 저장 시도 test
- 권한 거부·unavailable·timeout event 분리 test
- callback 하나의 저장 실패 후 다음 callback이 계속 저장되는 test
- recording session의 interrupted 복구와 watcher 자동 미실행 test
- 원본 객체 snapshot/hash가 후속 처리 전후 동일한 test

### iPhone Safari 검증

- SPEC `IOS-05~09`, `IOS-12`, `IOS-14` 중 로컬 부분
- 온라인 로그인 후 수동 시작·종료, 5분 정지, 권한 거부, timeout 가능 상황, 측정 중 비행기 모드, 측정 중 로그아웃 요청, 새로고침
- Windows의 자동 test와 fake-indexeddb에서 point 필드·sequence·measured/received 시각·null 보존을 정확히 검증
- 실제 iPhone에서는 개발 전용 진단 UI로 session ID 축약값, 저장 point 수, sequence 범위, 마지막 수신 시각, null 필드 개수와 저장·동기화 상태만 확인
- 개발 전용 진단 UI에는 이메일, OTP, access·refresh token, 전체 위도·경도 또는 GPS 원본 배열을 표시하지 않고 production build에서는 비활성화

### 다음 단계 진입 체크리스트

- [ ] 로그인·온라인이 아니면 새 session이 생성되지 않는다.
- [ ] 앱 진입만으로 위치 권한을 요청하지 않는다.
- [ ] 모든 위치 callback의 저장 결과를 추적할 수 있다.
- [ ] point와 sync item transaction이 원자적이다.
- [ ] 원본 GPS를 수정·삭제하는 경로가 없다.
- [ ] 첫 GPS 전 오류가 point가 아닌 event로 남는다.
- [ ] 비행기 모드에서도 진행 중 callback의 로컬 저장이 계속된다.
- [ ] 새로고침 후 interrupted가 되며 GPS를 자동 재시작하지 않는다.
- [ ] A 로그인 상태에서 B local 데이터가 노출되지 않는다.

### 실패 시 대응

- callback 순서가 섞이면 UI 기능을 늘리지 말고 session별 저장 queue부터 안정화한다.
- IndexedDB transaction 실패가 재현되면 sync 개발을 중단하고 원자성·오류 표시를 고친다.
- Safari가 전달하지 않은 callback은 복원하지 않으며 누락을 가짜 point로 채우지 않는다.
- 권한 거부 후 Safari 설정 변경이 필요한 경우 재허용 절차를 테스트 기록에 남긴다.

## 8. G3 — PostgreSQL 계약, RLS와 보안 경계

### 관련 요구사항

`SEC-001~004`, `DATA-001~003`, 이후 `SYNC-001~008`의 선행 조건

### 작업 목록

#### T3.1 migration 구현 계획 실행

- `walk_sessions`, `gps_points`, `measurement_events`, `point_quality`, `session_metrics`, `user_data_deletion_cutoffs` 생성
- PK, unique, composite FK, check, index와 cascade 적용
- 공통 단위, UTC, null 규칙과 schema/app/algorithm version 반영
- raw point client update·delete 금지

완료 조건: 브라우저 객체 없이 SQL 행만으로 사용자별 세션과 시간순 원본을 복원할 수 있다.

#### T3.2 grant와 RLS

- 모든 사용자 table RLS 활성화
- anon 권한 제거
- authenticated 최소 SELECT·INSERT 권한과 session 허용 열 UPDATE만 부여
- `auth.uid() = user_id` SELECT/INSERT/UPDATE 정책
- composite FK로 자식 user와 session owner 불일치 차단
- client DELETE 정책 없음

완료 조건: A·B·anon matrix와 owner 변경·raw 수정 공격이 DB에서 거부된다.

#### T3.3 deletion cutoff DB 방어선

- cutoff table은 본인 SELECT만 허용하고 변경은 관리자만 허용
- session BEFORE INSERT trigger로 cutoff 이전 session 거부
- cutoff 이후 새 session 허용
- `started_at`은 client 시계에서 생성되므로 cutoff 판정은 기기 시계가 합리적으로 정확하다는 전제의 방어선이며 완전한 재업로드 차단을 보장하지 않음

완료 조건: client가 cutoff guard를 우회해도 `started_at <= cutoff`인 session을 DB trigger가 거부하고, client 시계 오차에 따른 우회·오차 가능성이 테스트 결과와 운영 문서에 명시된다.

### 자동 검증

- Supabase local migration 재적용 test
- SPEC 9.4의 pgTAP 10개 시나리오
- FK·unique·cascade·허용 열 UPDATE 검증
- 두 사용자 JWT와 anon을 이용한 Data API 통합 test
- cutoff 이전 거부·이후 허용·다른 사용자 cutoff 미조회 test

### iPhone Safari 검증

- 아직 자동 sync 전이므로 로그인한 Safari에서 본인 데이터 조회 smoke test만 수행한다.
- A와 B 계정으로 직접 URL 접근 시 서버 응답이 서로 격리되는지 확인한다.

### 다음 단계 진입 체크리스트

- [ ] 빈 DB에 migration 전체를 재현 가능하게 적용할 수 있다.
- [ ] pgTAP 보안 matrix 10개가 모두 통과한다.
- [ ] anon과 A는 B 데이터를 읽거나 쓸 수 없다.
- [ ] session owner와 raw point를 client가 변경·삭제할 수 없다.
- [ ] composite FK가 자식 owner 불일치를 차단한다.
- [ ] cutoff 이전 insert는 거부되고 이후 insert는 허용된다.
- [ ] 저장소와 browser bundle에 관리자 key가 없다.

### 실패 시 대응

- RLS 실패는 UI 필터로 보완하지 않는다. policy·grant·FK를 고친 뒤 pgTAP 전체를 다시 실행한다.
- migration 재현이 안 되면 Dashboard 수동 SQL에 의존하지 말고 migration 순서를 정리한다.
- cutoff trigger의 시간 경계가 불안정하면 server timestamp fixture와 `<=` 경계를 먼저 고정한다.

## 9. G4 — 자동 동기화와 장애 복구

### 관련 요구사항

`LOC-001`, `LOC-003~005`, `SYNC-001~008`, `SEC-003`, `SEC-005`

### 작업 목록

#### T4.1 RemoteRepository

- platform-neutral DTO를 PostgreSQL snake_case로 변환
- session → point/event → quality/metrics 순서 API
- UUID conflict 무시 방식과 ID 재조회 확인 API
- deletion cutoff 조회

완료 조건: 동일 ID 반복 insert가 중복 행을 만들지 않고 실제 존재 여부를 다시 조회할 수 있다.

#### T4.2 SyncCoordinator guard와 scheduler

- 유효 user와 local owner 일치 확인
- cutoff를 먼저 조회·cache하고 오래된 session suppress
- point 저장 10초 debounce, 20개, 종료, app 시작, online, visible trigger
- 동시에 하나의 coordinator만 실행하도록 잠금
- session 1개, point 100개, 기타 50개 batch 기준 적용

완료 조건: 사용자 버튼 없이 trigger마다 현재 사용자 pending만 선택된다.

#### T4.3 상태 전이와 부분 실패

- pending → syncing → confirmed/retry_wait/failed/auth_required/owner_mismatch/suppressed_by_deletion
- 성공 항목만 confirmed, 실패 batch는 보존
- 5초·30초·120초 retry와 다음 lifecycle trigger 재시도
- 401 refresh 1회, 403·validation 자동 반복 금지
- 응답 유실 시 server ID 재조회

완료 조건: 부분 실패가 성공 데이터를 되돌리지 않고 GPS collector와 LocalRepository를 중단시키지 않는다.

#### T4.4 인증 만료와 계정 전환

- 측정 중 auth 만료 시 GPS·local 저장 유지, sync만 auth_required
- 같은 user 재로그인 후 재개
- 다른 user 로그인 시 이전 owner의 목록·상세·sync 제외

완료 조건: user A의 pending 항목이 user B 세션에서 한 건도 서버 요청되지 않는다.

### 자동 검증

- scheduler 10초·20 point·종료·시작·online·visible fake timer test
- parent session 실패 시 child 미전송 test
- duplicate insert, 응답 유실, batch 2개 중 1개 실패 test
- 401·403·429·5xx·validation 상태 전이 test
- auth 만료 후 같은 user 재개와 다른 user owner_mismatch test
- confirmed local raw가 자동 삭제되지 않는 test

### iPhone Safari 검증

- SPEC `IOS-09~11`, `IOS-13`, `IOS-15`
- 측정 중 비행기 모드 전환, 연결 복구, 페이지 background 후 visible 복귀, 강제 partial 실패, A 측정 후 B 로그인
- 서버 행 수와 local sync state를 함께 비교해 중복·누락을 확인

### 다음 단계 진입 체크리스트

- [ ] 로컬 transaction 성공 전 서버 요청이 발생하지 않는다.
- [ ] 자동 trigger 여섯 종류가 현재 user pending을 재시도한다.
- [ ] 반복 전송 후 server PK별 행이 하나다.
- [ ] server 재조회 전에는 confirmed가 되지 않는다.
- [ ] 부분 실패에서 성공·실패 batch가 분리된다.
- [ ] sync 실패가 GPS 수집과 local 저장을 멈추지 않는다.
- [ ] auth 만료 후 같은 user만 sync를 재개한다.
- [ ] B 로그인 중 A 데이터가 표시·전송되지 않는다.
- [ ] confirmed 원본도 IndexedDB에 남는다.

### 실패 시 대응

- 중복·누락이 한 건이라도 발생하면 품질·지도 단계로 넘어가지 않고 UUID, unique와 confirm query를 우선 수정한다.
- lifecycle trigger가 중복 실행되면 요청을 없애는 대신 coordinator 단일 실행 lock과 멱등성을 고친다.
- 부분 실패 재현이 어려우면 repository mock으로 결정론적 실패를 만든 뒤 실제 네트워크 테스트를 보강한다.

## 10. G5 — 품질 계산, 기록 목록과 상세

### 관련 요구사항

`HIST-001~003`, `QUAL-001~004`, `DATA-001~002`, `SEC-002`

### 작업 목록

#### T5.1 `quality-v1`

- invalid coordinate, accuracy > 50m, stale > 30초, non-monotonic time, speed > 3.5m/s 규칙
- 사유, 상태와 filtered path 포함 여부 생성
- point 원본과 별도 저장 및 algorithm version 기록

완료 조건: fixture마다 기대 quality 결과가 생성되고 원본 snapshot이 변하지 않는다.

#### T5.2 `metrics-v1`

- Haversine raw·filtered 거리
- 정상·interrupted duration
- segment speed, 평균 속도, pace
- device speed 별도 유지
- null altitude 최소·최대·표본 수

완료 조건: 경계 fixture에서 NaN·Infinity를 저장하지 않고 단위와 null 규칙을 지킨다.

#### T5.3 사용자별 기록 목록과 상세

- local+server session ID 병합과 중복 제거
- 현재 user owner filter
- 상태·동기화·시간·거리·point 수 표시
- 상세에 raw/filtered metrics와 algorithm version 표시

완료 조건: 동일 session은 한 번만 표시되고 A는 B의 직접 URL에서도 데이터를 볼 수 없다.

### 자동 검증

- 알려진 좌표의 Haversine 허용 오차 test
- 0 거리·0/음수 시간·null altitude·비단조 시각 test
- quality 원인별 fixture와 버전 key test
- 계산 전후 raw deep equality test
- local only, server only, 양쪽 존재 session merge test
- A/B owner filter와 직접 상세 URL test

### iPhone Safari 검증

- 정상 10분 걷기와 5분 정지 세션을 만들어 raw·filtered 거리, 속도, pace, altitude 표본을 확인
- A/B 계정의 목록·상세 격리와 재접속 후 server 기록 조회 확인
- 결과가 실측과 다르더라도 v1 규칙대로 설명 가능한지 확인하며 임의 보정은 추가하지 않음

### 다음 단계 진입 체크리스트

- [ ] quality와 metrics가 원본과 분리돼 있다.
- [ ] 다섯 quality 규칙이 fixture로 검증된다.
- [ ] raw·filtered 거리와 경로 대상이 구분된다.
- [ ] algorithm version이 local·server 결과에 남는다.
- [ ] 목록에서 동일 session이 중복되지 않는다.
- [ ] 상세가 PRD의 시간·거리·속도·pace·고도·point 수를 표시한다.
- [ ] A/B 로컬·서버 기록이 모두 격리된다.

### 실패 시 대응

- 실제 GPS가 임계값과 맞지 않아도 7일 중 알고리즘을 복잡하게 확장하지 않는다. 원본을 보존하고 fixture·실측 결과를 후속 개선 근거로 남긴다.
- NaN·Infinity가 발생하면 표시 계층에서 숨기지 말고 metrics 계산의 0 거리·시간 guard를 수정한다.

## 11. G6 — 지도 검증과 개인정보 삭제 방어

### 관련 요구사항

`MAP-001~005`, `SEC-005`, `LOC-002`

### 작업 목록

#### T6.1 카카오맵 지도

- 카카오맵 SDK와 저작권 표시 유지
- raw points marker 표시
- sequence 순 raw polyline과 quality 포함 filtered polyline
- 정상·낮은 정확도·튐·stale 스타일과 범례
- point 선택 시 measured_at과 accuracy 표시
- SDK 로딩 실패 시 텍스트 상세 유지

완료 조건: 저장된 raw point 수와 지도 source point 수가 일치하고 두 경로가 명확히 구분된다.

#### T6.2 삭제 수동 절차

- 요청자 Auth 소유권 확인 절차 문서화
- 관리자 transaction에서 server cutoff 기록 후 과거 session cascade 삭제
- 처리 행 수·cutoff 확인과 완료 통지 형식
- 계정 유지와 Auth 계정 삭제 절차 구분
- Safari 웹사이트 데이터 수동 삭제 안내

완료 조건: 운영자가 브라우저에 관리자 key를 넣지 않고 재현 가능한 순서로 삭제할 수 있다.

#### T6.3 삭제 후 재업로드 방어 종단 검증

- server cutoff를 받은 client가 old local을 suppressed_by_deletion으로 표시
- 동기화 선택 대상에서 session과 자식 제외
- client guard 우회 insert는 DB trigger가 거부
- cutoff 이후 새 session 정상 sync
- 계정 삭제 후 같은 이메일 재가입의 새 UUID가 old local owner와 불일치
- 현 cutoff 방식은 client `started_at`에 의존하므로 의도적으로 잘못된 기기 시각까지 포함한 완전한 차단 보장은 하지 않음
- 향후 개선 후보로 서버가 사용자별 `data_generation`을 발급하고 session이 현재 generation을 제시해야 insert를 허용하는 방식을 기록하되 첫 MVP에는 구현하지 않음

완료 조건: 정상적인 client 시계 조건에서 서버에 한 번도 올라오지 않은 cutoff 이전 local session이 client guard와 DB trigger로 거부되며, 시계 오차 한계와 Safari local data 삭제 안내가 함께 검증된다.

### 자동 검증

- GeoJSON coordinate order와 sequence, raw point 수, layer style test
- point click ID와 상세 값 mapping test
- cutoff local suppress integration test
- cutoff guard 우회 DB trigger test
- 삭제 cascade와 이후 새 session 허용 pgTAP
- Auth 삭제·새 UUID 상황 owner mismatch test

### iPhone Safari 검증

- SPEC `IOS-16~18`
- 실제 세션의 raw/filtered 지도, point 선택과 accuracy 확인
- 계정 유지 전체 삭제 후 old local이 목록·sync에서 제외되고 새 측정은 동기화되는지 확인
- Auth 계정 삭제 후 재가입 시 old local이 노출·전송되지 않는지 확인

### 다음 단계 진입 체크리스트

- [ ] 모든 raw point가 지도 source에 포함된다.
- [ ] raw route는 sequence 순이며 도로에 임의 매칭되지 않는다.
- [ ] 품질 사유와 raw·filtered 경로가 구분된다.
- [ ] 선택 point의 시각·accuracy가 정확하다.
- [ ] 삭제 절차가 계정 유지·계정 삭제를 구분한다.
- [ ] 정상적인 client 시계 조건에서 old local을 client와 DB 양쪽의 cutoff 방어로 거부한다.
- [ ] cutoff 이후 새 session은 정상 저장된다.
- [ ] Safari local data를 원격 삭제할 수 없다는 안내가 포함된다.
- [ ] client 시계 의존 한계와 향후 server `data_generation` 개선 후보가 문서화됐다.

### 실패 시 대응

- WebGL이나 map style이 실패해도 원본을 변경하지 않고 텍스트 상세를 유지한다.
- 정상적인 client 시계의 cutoff 이전 old local이 재삽입되면 배포를 중단하고 cutoff 조회 순서와 DB trigger를 모두 재검증한다.
- client 시계 오차 한계는 숨기지 않고 삭제 완료 시 local data 삭제 안내를 필수로 유지한다.

## 12. G7 — 배포, 실제 iPhone 회귀 테스트와 MVP 판정

### 관련 요구사항

P0 48개 전체와 MVP 성공 기준 12개

### 작업 목록

#### T7.1 production 배포 준비

- Vercel production 환경변수 등록
- Vite `dist`, SPA rewrite, HTTPS와 source map 정책 확인
- Supabase Site URL·허용 URL을 production 주소로 확인
- 카카오 JavaScript SDK production domain과 저작권 표시 확인
- production bundle secret scan

#### T7.2 자동 회귀

- typecheck·lint·unit·component·integration·build 전체 실행
- Supabase local migration clean apply와 pgTAP 전체 실행
- P0 traceability matrix별 test 결과 연결
- 반복 실행에서 flaky test 분리·수정

#### T7.3 실제 실보행 회귀

- SPEC `IOS-01~18` 전체 수행
- 최소 정상 10분 걷기 1회, 정지 5분 1회, 연결 단절·복구 1회
- A/B 계정 격리, 부분 실패, auth 만료, 삭제 cutoff 시나리오 수행
- iPhone 모델, iOS/Safari, 앱 version, 저전력 모드, 네트워크와 시각 기록

### 최종 출시 체크리스트

- [ ] P0 48개가 구현 작업과 test 결과에 연결된다.
- [ ] 모든 자동 test와 production build가 통과한다.
- [ ] pgTAP RLS·소유권·cutoff test가 통과한다.
- [ ] `IOS-01~18` 결과가 기록됐다.
- [ ] 실제 보행 원본 수와 저장·서버 확인 수를 비교했다.
- [ ] 중복 서버 행이 없다.
- [ ] 다른 사용자 데이터가 UI와 Data API에서 보이지 않는다.
- [ ] Secret·Service Role·관리자 credential이 bundle과 저장소에 없다.
- [ ] 원본 불변성과 IndexedDB 우선 저장이 회귀 test로 보호된다.
- [ ] 알려진 Safari·IndexedDB·client clock 한계를 사용자·운영 문서에 남겼다.
- [ ] P1 또는 제품 로드맵 기능이 섞이지 않았다.

### 실패 시 대응

- 보안, owner 격리, 원본 무결성, 중복 방지 또는 문서화된 정상 시계 조건의 cutoff 방어 실패는 출시 차단 결함이다.
- Safari 연속 GPS처럼 기술적으로 보장할 수 없는 항목은 실패로 숨기지 않고 기기·조건·관측 결과를 기록한다.
- 7일 안에 출시 차단 결함을 해결하지 못하면 범위를 확장하지 않고 일정만 연장한다.

## 13. 현재 구현 상태와 후속 개발 연결 (2026-10-30)

초기 P0 계획과 48개 요구사항의 구현 이력은 아래 추적성 표에 그대로 보존한다. 현재 제품 단계의 상태는 다음과 같다.

| 제품 단계 | 현재 상태 | 남은 검증 |
|---|---|---|
| G1~G5 | 구현 및 실제 iPhone Safari 검증 완료 | 없음 |
| G6 이동·정지 분석 | `movement-v1` 구현 및 실제 신호 대기 포함 실기기 검증 완료 | 없음 |
| G7 개인 보행속도 학습 | `recency-weighted-v1` 구현·배포, 기존 결과 표시와 신규 보행 기록 반영의 iPhone Safari 종단 검증 완료 | 없음 |

G6·G7 분석 기준은 각각 `docs/G6_MOVEMENT_ANALYSIS.md`, `docs/G7_WALKING_SPEED_MODEL.md`를 따른다.

### 13.1 G8 이후 계획 문서

G8~G17은 초기 P0 계획에 섞지 않고 `docs/SMART_ARRIVAL_SPEC.md`에서 별도로 관리한다.

1. G8 도보 경로 탐색 및 개인화 ETA
2. G9 실시간 현재 위치·보행속도 기반 ETA 갱신 및 추천 보행속도
3. G10 약속 장소·도착 목표시각 입력 및 추천 출발시간 계산
4. G11 버스·지하철 경로 탐색 및 환승시간 반영
5. G12 버스·지하철 시간표 및 실시간 도착예정정보 연동
6. G13 출발 알림 및 교통편 변동에 따른 재계산
7. G14 횡단보도·신호 대기시간 정밀화
8. G15 오르막·내리막 경사도 보정
9. G16 날씨에 따른 보행속도 보정
10. G17 데이터와 성능 기준을 충족한 경우에만 머신러닝 도입

G17은 고정 일정이 아니다. 신규 사용자는 기본 속도, 충분한 개인 기록이 있는 사용자는 G7 가중평균을 사용하며, 머신러닝은 시간순 검증에서 G7보다 나은 성능을 보일 때만 적용한다. G7 모델은 비교 기준과 장애 시 대체 수단으로 유지한다.

## 14. P0 요구사항 추적성

| PRD 범위 | 개수 | 주 구현 작업 | 최종 검증 게이트 |
|---|---:|---|---|
| `AUTH-001~007` | 7 | T1.1~T1.3 | G1, G7 |
| `REC-001~008` | 8 | T2.3~T2.4 | G2, G7 |
| `LOC-001~005` | 5 | T2.1~T2.2, T4.2~T4.3 | G2, G4, G7 |
| `SYNC-001~008` | 8 | T4.1~T4.4 | G4, G7 |
| `HIST-001~003` | 3 | T5.3 | G5, G7 |
| `QUAL-001~004` | 4 | T5.1~T5.2 | G5, G7 |
| `MAP-001~005` | 5 | T6.1 | G6, G7 |
| `SEC-001~005` | 5 | T1.3, T2.2, T3.1~T3.3, T6.2~T6.3 | G1~G3, G6, G7 |
| `DATA-001~003` | 3 | T2.1~T2.3, T3.1, T5.1~T5.2 | G2, G3, G5, G7 |
| 합계 | **48** | 누락 없음 | G7 전체 회귀 |

### ID별 핵심 완료 증거

| ID | 완료 증거 |
|---|---|
| AUTH-001 | 비로그인 보호 route와 GPS 미호출 test |
| AUTH-002 | OTP 발송 성공 UI와 API 호출 test |
| AUTH-003 | `verifyOtp(type=email)` 성공 후 user·session 확인 |
| AUTH-004 | 신규 이메일 자동 user 생성 실기기 결과 |
| AUTH-005 | 새로고침·재접속 session 복원 test |
| AUTH-006 | idle 로그아웃과 recording 로그아웃 차단 test |
| AUTH-007 | OTP 오류 mapping과 미저장·미로그 test |
| REC-001 | 로그인·온라인 start guard와 owner 고정 session |
| REC-002 | 버튼 전 권한 미요청, 버튼 후 요청 실기기 결과 |
| REC-003 | 수동 종료만 clearWatch·ended_at 기록 |
| REC-004 | callback별 point 또는 저장 실패 결과 |
| REC-005 | 네 종류 시각 필드 조회 결과 |
| REC-006 | 원본 필드와 선택값 null fixture |
| REC-007 | UUID·sequence 중복 없음 test |
| REC-008 | recording → interrupted와 watcher 미재시작 test |
| LOC-001 | point+sync transaction 이후에만 remote 호출 |
| LOC-002 | 처리 전후 raw deep equality |
| LOC-003 | network·auth 실패 중 callback 저장 test |
| LOC-004 | 재접속 pending 복구 test |
| LOC-005 | confirmed 후 local raw 잔존 test |
| SYNC-001 | A 로그인 중 B owner request 0건 |
| SYNC-002 | 저장 후 debounce·batch 자동 실행 test |
| SYNC-003 | 종료·재접속·online·visible trigger test |
| SYNC-004 | parent 확인 전 child 미완료 test |
| SYNC-005 | 반복 insert 후 server 행 1개 |
| SYNC-006 | 응답 유실 후 ID 재조회 전 미확정 test |
| SYNC-007 | 성공 confirmed·실패 retry 분리 test |
| SYNC-008 | sync 실패 중 GPS local 저장 지속 test |
| HIST-001 | A/B local·server 목록과 직접 URL 격리 |
| HIST-002 | 같은 session ID 단일 표시 test |
| HIST-003 | 상세 필수 summary와 version 표시 |
| QUAL-001 | raw와 quality·metrics 별도 store/table |
| QUAL-002 | 다섯 quality 사유 fixture |
| QUAL-003 | raw·filtered 거리와 경로 동시 결과 |
| QUAL-004 | algorithm version key·저장 결과 |
| MAP-001 | raw 저장 수와 GeoJSON point 수 일치 |
| MAP-002 | sequence 순 raw LineString test |
| MAP-003 | quality 사유별 style·범례 |
| MAP-004 | raw·filtered line style 구분 |
| MAP-005 | point ID별 measured_at·accuracy 표시 |
| SEC-001 | 본인 행만 허용하는 RLS pgTAP |
| SEC-002 | anon·A의 B 접근 거부와 UI 미노출 |
| SEC-003 | local·DB owner 변경 거부 test |
| SEC-004 | repository·bundle secret scan |
| SEC-005 | 정상 시계 조건의 cutoff 이전 old local 거부 종단 test와 client 시계 한계 문서 |
| DATA-001 | 일반 SQL 열로 session 재구성 test |
| DATA-002 | UTC·m·m/s·degree·null contract test |
| DATA-003 | GPS point와 오류 event 분리 test |

## 15. 위험 검증 시점

| 위험 | 최초 검증 | 재검증 | 출시 차단 기준 |
|---|---|---|---|
| OTP template·자릿수·발송 제한 | G0~G1 | G7 production | 로그인 불가 또는 링크 발송 |
| Safari GPS callback·권한 | G2 첫날 | G7 실보행 | 정상 전면 측정 불가 |
| IndexedDB transaction·원본 불변 | G2 | G4, G5, G7 | 원본 누락·덮어쓰기 |
| 사용자별 RLS·owner 불변 | G3 | G4, G7 | 타 사용자 접근 가능 |
| 중복·부분 동기화·응답 유실 | G4 | G7 | 중복·누락·오확정 |
| auth 만료·계정 전환 | G4 | G7 | 이전 owner 전송·노출 |
| quality 계산의 원본 침범 | G5 | G6, G7 | raw 변경·삭제 |
| 삭제 후 old local 재업로드 | G3 trigger, G6 종단 | G7 | 정상 시계 조건의 cutoff 이전 재삽입; client 시계 오차는 잔여 위험 |
| 지도 point 누락·순서 오류 | G6 | G7 | 원본과 지도 불일치 |
| production key 노출 | G0 | G7 bundle | 금지 credential 포함 |

## 16. 첫 번째 구현 작업 추천

첫 구현 작업은 **OTP 인증 수직 슬라이스**다. 이 작업 안에서 필요한 최소 G0 기반—Git 기준점, React/Vite/TypeScript 실행·test 환경과 Supabase browser client—만 먼저 준비한 뒤, `/login`에서 이메일 OTP를 요청·검증하고 `/` 보호 route로 이동하는 한 경로를 완성한다. 지도·GPS·DB migration은 이 첫 작업에 섞지 않는다.

이 작업을 먼저 해야 실제 Supabase OTP 자릿수·템플릿·발송 제한과 iPhone Safari 세션 복원을 초기에 확인할 수 있고, 이후 생성되는 모든 GPS session에 신뢰할 수 있는 owner user ID를 부여할 수 있다.

### 첫 작업 검증 방법

1. 자동 test로 로그아웃 보호 route, OTP 발송·검증 호출, 신규 user 생성 옵션, session 복원과 OTP 미저장을 확인한다. SDK 관리 token 저장은 허용하되 애플리케이션의 별도 저장·복제가 없는지도 검사한다.
2. production과 분리된 HTTPS preview를 iPhone Safari에서 연다.
3. 신규 테스트 이메일로 OTP를 요청하고 링크가 아닌 6자리 코드가 오는지 확인한다.
4. 올바른 코드 입력 후 `/`로 이동하고 user ID가 확인되는지 본다.
5. Safari 새로고침 후 OTP 재입력 없이 세션이 복원되는지 확인한다.
6. 로그아웃 후 `/`, `/history`, 임의 상세 URL이 `/login`으로 이동하는지 확인한다.
7. 개발 전용 진단 UI에서 인증됨 여부만 확인하고, OTP·token·이메일 원문이 표시되지 않는지 확인한다. 저장소의 정확한 검사는 Windows 자동 test로 수행하며 SDK 관리 session token 자체는 허용한다.
8. 이 검증이 모두 성공한 뒤에만 G2의 IndexedDB와 GPS collector 구현으로 넘어간다.
