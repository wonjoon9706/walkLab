# WalkLab Technical Specification

- 문서 상태: 확정 초안
- 문서 버전: 0.3
- 수정일: 2026-10-30
- 기준 문서: `MVP.md`, `PRD.md`
- 대상 범위: 첫 번째 WalkLab MVP P0
- 개발 기간 기준: 1인 개발, 7일

> 이 문서의 본문은 첫 P0 기술 명세를 보존한다. 이후 구현된 G6 이동·정지 분석, G7 개인 보행속도 모델과 G8 이후 Smart Arrival 설계는 아래의 “현재 구현 부록”과 별도 문서를 함께 참조한다.

## 1. 목적과 범위

이 문서는 이메일 OTP로 로그인한 사용자가 iPhone Safari에서 수동으로 GPS 측정을 시작·종료하고, 원본을 IndexedDB에 먼저 저장한 뒤 Supabase로 자동 동기화하고, 지도에서 품질을 검증하는 P0 기술 설계를 정의한다.

다음은 구현하지 않는다.

- 로그인 전 측정·기록 조회와 미귀속 기록
- 매직 링크, 고정 PIN, 비밀번호와 소셜 로그인
- 인터넷 없는 신규 실행·신규 측정 시작
- Service Worker·PWA 오프라인 앱·백그라운드 동기화
- 자동 걷기 감지·자동 시작·자동 종료
- 개인화 ETA, Smart Arrival, 경로 탐색과 대중교통
- 사용자용 삭제 UI와 관리자 대시보드

## 2. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 웹 | React + Vite + TypeScript | 단일 SPA를 빠르게 만들고 GPS·동기화 타입 오류를 줄임 |
| 라우팅 | React Router | 로그인 guard와 네 화면을 단순하게 관리 |
| 로컬 DB | IndexedDB + Dexie | 타입, 트랜잭션, 인덱스와 schema version 관리 |
| 서버 | Supabase PostgreSQL | 장기 보관, Python·iOS 공유와 Data API |
| 인증 | Supabase Auth 이메일 OTP | 링크 클릭 없이 같은 화면에서 인증 |
| 지도 | 카카오맵 JavaScript SDK | WGS84 경로·마커와 모바일 터치 지도 제공 |
| 배포 | Vercel 정적 배포 | HTTPS와 Vite 배포가 단순함 |
| 테스트 | Vitest + fake-indexeddb | 계산·로컬 DB 검증 |
| DB 테스트 | Supabase CLI + pgTAP | grant·RLS·trigger 검증 |

- Node.js는 Vite 요구사항을 만족하는 22.12 이상 계열을 고정한다.
- `package-lock.json`으로 실제 설치 버전을 고정한다.
- Redux, 별도 API 서버, 메시지 큐와 마이크로서비스는 사용하지 않는다.
- 품질 알고리즘은 `quality-v1`, metrics는 `metrics-v1`, schema는 `1`로 시작한다.
- 현재 지도 구현은 카카오맵 JavaScript SDK다. 과거 검토했던 MapLibre·MapTiler는 현재 코드와 환경변수에서 사용하지 않는다.

## 3. 전체 아키텍처

```text
iPhone Safari / React SPA
  ├─ Auth UI ─────────────── Supabase Auth (Email OTP)
  ├─ Measurement UI
  │    └─ GPS Collector
  │         └─ Local Repository (Dexie / IndexedDB)
  ├─ Sync Coordinator
  │    ├─ Current User Guard
  │    ├─ Deletion Cutoff Guard
  │    └─ Supabase Data Repository ── PostgreSQL + RLS
  ├─ Quality / Metrics (pure TypeScript)
  └─ Session Map (카카오맵 JavaScript SDK)
```

### 3.1 모듈 계약

| 모듈 | 입력 | 책임·출력 | 금지 의존성 |
|---|---|---|---|
| `AuthService` | 이메일, OTP | 발송, 검증, 세션 복원·갱신·로그아웃 | GPS, IndexedDB |
| `RouteGuard` | auth 상태 | 보호 경로 접근 허용·차단 | GPS 원본 |
| `GpsCollector` | 시작·중지, Geolocation callback | `RawGpsPointInput`, `MeasurementEventInput` | Supabase, 지도 |
| `LocalRepository` | 세션·점·이벤트·파생 결과 | IndexedDB transaction과 사용자별 조회 | React UI, Supabase |
| `SyncCoordinator` | current user, pending 항목, online 신호 | 전송 순서와 sync 상태 전이 | React 렌더링, GPS API |
| `RemoteRepository` | 플랫폼 중립 DTO | Supabase insert·update·confirm·cutoff 조회 | Dexie 구현 |
| `QualityService` | 순서가 보장된 원본 | 버전이 있는 판정과 metrics | UI, DB 라이브러리 |
| `SessionRouteMap` | 위도·경도 경로 좌표 | 카카오맵 polyline·시작/종료 marker와 영역 조정 | 원본 수정, 동기화 |

TypeScript 도메인 객체는 camelCase, 서버 열은 snake_case를 사용하며 remote repository에서 변환한다. PostgreSQL schema가 Python과 iOS의 공통 계약이다.

## 4. 프로젝트 구조와 라우팅

```text
src/
  app/
    router.tsx
    env.ts
  domain/
    measurement.ts
    history.ts
    movementAnalysis.ts
    walkingSpeedModel.ts
  pages/
    LoginPage.tsx
    MeasurementPage.tsx
    HistoryPage.tsx
    SessionDetailPage.tsx
  features/
    auth/
    measurement/
    sync/
    analysis/
    learning/
    map/
  services/
    analysis/movementAnalysis.ts
    analysis/personalWalkingStats.ts
    learning/walkingSpeedModel.ts
    learning/walkingSpeedModelConfig.ts
    auth/authService.ts
    gps/gpsCollector.ts
    sync/syncCoordinator.ts
    analysis/walkingAnalysis.ts
    history/walkHistoryService.ts
  repositories/
    local/walkLabDatabase.ts
    local/localMeasurementRepository.ts
    remote/supabaseClient.ts
    remote/remoteSyncRepository.ts
    remote/historyRepository.ts
  utils/
    format.ts
supabase/
  migrations/
  tests/
```

### 4.1 라우트

| 경로 | 화면 | guard |
|---|---|---|
| `/login` | 이메일·OTP 2단계 로그인 | 인증 사용자는 `/`로 이동 |
| `/` | 측정 홈 | 인증 필수 |
| `/history` | 기록 목록 | 인증 필수 |
| `/sessions/:sessionId` | 세션 상세·지도 | 인증 + 로컬 소유권 또는 RLS |

앱 초기화 중에는 보호 화면을 먼저 그리지 않고 auth 확인 상태를 표시한다. 로그아웃 상태에서 보호 경로를 직접 열면 `/login`으로 이동한다.

## 5. 이메일 OTP 인증

### 5.1 Supabase Dashboard 설정

1. Authentication의 Email provider를 활성화한다.
2. `Magic Link or OTP` 이메일 템플릿을 연다.
3. 본문에 `{{ .Token }}`을 넣는다.
4. `{{ .ConfirmationURL }}` 링크는 제거해 기본 매직 링크가 발송되지 않게 한다.
5. 제목과 본문을 “WalkLab 인증번호”로 바꾸고 코드 외 로그인 링크를 넣지 않는다.
6. Email OTP expiration을 확인하고 MVP는 3,600초로 고정한다.
7. Email OTP 길이를 실제 project 설정에서 확인하고 6자리로 고정한다.
8. Authentication > Rate Limits에서 email/OTP 제한을 확인한다.

Supabase 공식 설정의 이메일 OTP 기본 길이는 6자리이고 허용 범위는 6~10자리다. 이 프로젝트의 목표 UX와 project 설정은 6자리로 맞춘다. 문서만으로 사용자의 실제 hosted project 설정값을 읽을 수 없으므로 구현 시작 전 Dashboard 또는 Management API 설정 조회로 `otp_length = 6`을 확인해야 한다. 실제 값이 다르면 서버 설정을 6으로 수정하거나, 수정 전에는 UI가 6~10자리 숫자를 허용하고 서버 검증 결과를 권위로 사용한다.

### 5.2 최초 가입 정책

`signInWithOtp()`의 `shouldCreateUser`를 명시적으로 `true`로 사용한다. 신규 이메일은 별도 가입 화면 없이 OTP 검증을 통해 계정을 자동 생성한다. 첫 MVP 사용성과 화면 수를 최소화하기 위한 선택이다.

### 5.3 OTP 발송

개념적 호출 계약:

```ts
supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: true }
})
```

- 이메일은 trim과 소문자 표시 정규화만 하며 Supabase가 최종 유효성을 판단한다.
- 성공 응답 시 user와 session이 null일 수 있으므로 “이메일 확인” 단계로 이동한다.
- 요청 이메일은 OTP 검증 단계가 끝날 때까지 React 메모리 상태에 유지한다.
- 새로고침하면 이메일과 OTP를 다시 입력하도록 하며 OTP 자체는 localStorage, sessionStorage, IndexedDB, URL 또는 로그에 저장하지 않는다.

### 5.4 OTP 검증

```ts
supabase.auth.verifyOtp({
  email,
  token,
  type: 'email'
})
```

- 입력은 기본 6자리 숫자 UX와 `autocomplete="one-time-code"`, 숫자 키패드를 사용한다.
- 실제 project 길이가 6으로 확인되기 전에는 6~10자리 입력을 기술적으로 허용할 수 있다.
- 검증 성공 시 반환 session과 user를 확인하고 OTP 메모리 값을 즉시 지운다.
- 인증 성공 후 `/`로 이동한다.
- 검증 실패 시 OTP만 지우고 이메일은 재시도를 위해 메모리에 유지할 수 있다.

### 5.5 발송 제한·만료·오류

- OTP 재요청 기본 간격은 60초다.
- 기본 OTP 만료는 3,600초로 설정·검증한다.
- Supabase 기본 이메일 제공자는 프로젝트 전체 이메일 발송 제한이 낮고 현재 공식 기본은 시간당 2회다.
- 기본 이메일 제공자는 조직 team에 사전 허용된 주소만 발송하므로 초기 본인 테스트 이메일을 team 주소로 사용한다.
- 외부 사용자 테스트 전에는 custom SMTP가 필요하지만 P0 구현 범위에는 포함하지 않는다.

오류 매핑:

| Supabase·상황 | UI 처리 |
|---|---|
| `over_email_send_rate_limit` | 이메일 발송 제한, 잠시 후 재시도 |
| `over_request_rate_limit` | 요청 과다, 잠시 후 재시도 |
| `otp_expired` | 만료 또는 잘못된 코드, 새 코드 요청 안내 |
| `otp_disabled` | 프로젝트 설정 오류 |
| 네트워크 오류 | 연결 확인, 코드·GPS 원본 유지 |
| 검증 실패 | 세션 생성 안 함, 입력 코드 삭제 |

OTP 값, access token과 refresh token은 애플리케이션 오류 이벤트·console·분석 로그에 기록하지 않는다.

### 5.6 세션 유지와 로그아웃

- Supabase client의 `persistSession: true`, `autoRefreshToken: true`를 사용한다.
- 앱 시작 시 `getSession()`으로 로컬 세션을 복원하고 보호 UI 상태를 정한다.
- 보호 작업과 측정 시작 직전에는 `getUser()`로 서버 검증된 현재 user를 확인한다.
- `onAuthStateChange`로 sign-in, token refresh와 sign-out을 반영한다.
- 측정 중 token 갱신 실패는 GPS를 중단하지 않고 sync만 `auth_required`로 바꾼다.
- 명시적 로그아웃은 측정 중 차단하고 사용자가 먼저 종료 버튼을 누르게 한다.
- 측정 중이 아니면 `signOut()` 후 메모리 사용자 상태를 지우고 `/login`으로 이동한다.

## 6. GPS 수집과 측정 상태

### 6.1 시작 전 조건

측정 시작 버튼은 다음을 모두 만족할 때만 활성화한다.

- auth 상태가 `authenticated`
- `getUser()`가 현재 user를 반환
- `navigator.onLine = true`
- Geolocation API 사용 가능
- 다른 active measurement 없음

인터넷이 없거나 인증 확인이 실패하면 새 측정을 만들지 않는다.

### 6.2 세션 생성과 watcher

1. 버튼 클릭 시 session UUID와 `started_at`을 만든다.
2. 현재 `user.id`를 `owner_user_id`로 넣어 local session을 먼저 저장한다.
3. `measurement_start_requested` 이벤트를 저장한다.
4. `watchPosition()`을 시작한다.
5. 첫 성공 시 `measurement_started`, 첫 성공 전 오류는 같은 session의 오류 이벤트로 저장한다.

옵션:

| 옵션 | 값 |
|---|---|
| `enableHighAccuracy` | `true` |
| `maximumAge` | `0` |
| `timeout` | `15000`ms |

이 옵션은 요청이며 정확도·센서·주기를 보장하지 않는다.

### 6.3 위치 콜백

1. 콜백 진입 즉시 `received_at`을 기록한다.
2. `position.timestamp`를 `measured_at`으로 변환한다.
3. session별 `sequence_no`를 증가시킨다.
4. `crypto.randomUUID()`로 point ID를 생성한다.
5. 원본 필드를 변형·반올림·필터링하지 않는다.
6. point와 pending sync item을 Dexie transaction으로 저장한다.
7. 저장 성공 후 UI와 자동 sync scheduler를 갱신한다.

콜백 저장은 session별 Promise chain으로 순서를 유지한다. 한 저장 실패가 다음 콜백 저장을 막지 않도록 catch 후 체인을 계속한다.

### 6.4 수동 종료

- 종료 버튼만 정상 종료를 수행한다.
- `clearWatch()` 후 마지막 저장 chain 완료를 기다린다.
- `ended_at`과 completed 상태를 저장한다.
- quality와 metrics를 전체 원본으로 다시 계산한다.
- 즉시 자동 동기화를 예약한다.
- 정지, 신호 대기와 위치 흔들림은 자동 종료 조건이 아니다.

### 6.5 비정상 종료와 인증 만료

- 앱 시작 시 local status가 recording인 세션을 interrupted로 변경한다.
- GPS를 자동 재시작하지 않는다.
- ended_at은 null로 유지하고 마지막 received_at을 임시 duration 계산에 사용할 수 있다.
- 인증 만료 중에도 active watcher와 local 저장을 유지한다.
- sync만 보류하며 같은 user의 재인증 후 재개한다.
- 다른 user 로그인 시 이전 user 세션을 화면·동기화 대상에서 제외한다.

### 6.6 Safari 제약

- hidden/visible 시각을 이벤트로 저장하지만 누락 위치를 생성하지 않는다.
- 화면 잠금·앱 전환 중 콜백을 보장하지 않는다.
- Wake Lock, Service Worker 위치 수집과 백그라운드 sync를 사용하지 않는다.
- HTTPS가 아니면 GPS를 시작하지 않는다.

## 7. IndexedDB 설계

### 7.1 DB와 store

- DB: `walklab`
- Dexie schema version: `1`

| Store | 주요 키·인덱스 | 역할 |
|---|---|---|
| `meta` | `key` | installation ID, schema metadata |
| `sessions` | `id`, `owner_user_id`, `status`, `started_at` | 사용자 소유 측정 세션 |
| `gps_points` | `id`, `session_id`, `[session_id+sequence_no]` | 불변 GPS 원본 |
| `measurement_events` | `id`, `session_id`, `event_type`, `occurred_at` | 측정·오류 이벤트 |
| `point_quality` | `key`, `session_id`, `algorithm_version` | 버전별 품질 판정 |
| `session_metrics` | `key`, `session_id`, `algorithm_version` | 버전별 요약 계산 |
| `sync_items` | `key`, `owner_user_id`, `state`, `session_id` | 엔티티별 동기화 상태 |
| `deletion_cutoffs` | `owner_user_id` | 서버 삭제 기준 로컬 캐시 |

### 7.2 Local session

| 필드 | 타입·규칙 |
|---|---|
| `id` | UUID PK |
| `owner_user_id` | UUID, NOT NULL, 생성 후 변경 금지 |
| `status` | starting/recording/completed/interrupted/error |
| `started_at` | UTC ISO string |
| `ended_at` | UTC ISO string 또는 null |
| `installation_id` | UUID |
| `source_platform` | `web-ios-safari` 등 |
| `app_version`, `schema_version` | 버전 |
| `created_at`, `updated_at` | UTC ISO string |

미귀속·claimed 상태는 존재하지 않는다. owner는 세션 생성 시 확정한다.

### 7.3 Raw GPS point

| 필드 | 타입·규칙 |
|---|---|
| `id`, `session_id` | UUID |
| `sequence_no` | integer |
| `measured_at`, `received_at` | UTC ISO string |
| `latitude`, `longitude`, `accuracy_m` | number |
| `altitude_m`, `altitude_accuracy_m` | number 또는 null |
| `device_speed_mps`, `heading_deg` | number 또는 null |
| `schema_version` | 1 |

원본 store는 생성 후 수정하지 않는다. 동기화 상태는 별도 store에 둔다.

### 7.4 Event

- `id`, `session_id`, `event_type`
- `occurred_at`, `received_at`
- `error_code`, 민감정보 없는 `details`
- `schema_version`

세션은 시작 버튼에서 먼저 생성되므로 첫 GPS 성공 전 권한·timeout 이벤트도 session에 연결할 수 있다.

### 7.5 Quality와 metrics

- quality key: `${point_id}:${quality_algorithm_version}`
- metrics key: `${session_id}:${metrics_algorithm_version}`
- metrics는 사용한 `quality_algorithm_version`도 기록한다.
- 파생 계산 실패가 원본 transaction을 롤백하지 않는다.

### 7.6 Sync item

| 필드 | 설명 |
|---|---|
| `key` | entity type + ID + version |
| `owner_user_id` | 현재 Auth user와 비교 |
| `entity_type`, `entity_id`, `session_id` | 전송 대상 |
| `state` | pending/syncing/confirmed/retry_wait/failed/auth_required/owner_mismatch/suppressed_by_deletion |
| `attempt_count`, `next_retry_at` | 재시도 |
| `last_error_code` | 진단 코드 |
| `server_confirmed_at` | 완료 시각 |

### 7.7 트랜잭션

- session 생성과 session sync item 생성은 한 transaction이다.
- point와 point sync item 생성은 한 transaction이다.
- `add`를 사용해 raw ID를 덮어쓰지 않는다.
- local 저장 실패는 즉시 표시한다.
- IndexedDB 전체 장애에서는 같은 DB에 실패 이벤트를 확실히 저장할 수 없으므로 메모리 경고만 보장한다.

### 7.8 사용자별 조회

- repository의 모든 목록·상세 query는 `owner_user_id = current_user_id`를 필수로 받는다.
- 로그아웃 상태에는 local query 결과를 UI에 반환하지 않는다.
- 직접 URL의 session ID도 owner가 다르면 not found로 처리한다.
- IndexedDB를 암호화하지 않으므로 기기 개발 도구 수준의 접근 방지는 P0 범위가 아니다.

### 7.9 저장소 손실과 대응

- Safari 사이트 데이터 삭제, 브라우저 저장공간 회수, 비공개 브라우징과 기기 손실로 IndexedDB가 사라질 수 있다.
- 앱은 local transaction 실패를 즉시 표시하고, 온라인일 때 자동 동기화를 자주 실행해 미동기화 구간을 줄인다.
- `navigator.storage.persist()` 요청과 저장량 UI는 P1이며, 성공하더라도 사용자 삭제나 기기 손실을 막는 보장은 아니다.
- 서버 확인 전 미동기화 원본의 영구 보존은 보장하지 않는다고 테스트 안내와 운영 문서에 명시한다.

## 8. Supabase PostgreSQL

### 8.1 관계

```text
auth.users
  ├─ walk_sessions
  │    ├─ gps_points ── point_quality
  │    ├─ measurement_events
  │    └─ session_metrics
  └─ user_data_deletion_cutoffs
```

모든 자식 행에 `user_id`를 저장하고 복합 외래 키로 session 소유자와 일치시킨다.

### 8.2 `walk_sessions`

| 열 | 타입·제약 |
|---|---|
| `id` | uuid PK, client 생성 |
| `user_id` | uuid NOT NULL, FK auth.users ON DELETE CASCADE |
| `installation_id` | uuid NOT NULL |
| `status` | text check |
| `started_at` | timestamptz NOT NULL |
| `ended_at` | timestamptz nullable |
| `source_platform`, `app_version` | text NOT NULL |
| `schema_version` | smallint NOT NULL |
| `created_at`, `updated_at` | timestamptz server default |

- UNIQUE `(id, user_id)`
- index `(user_id, started_at desc)`
- user_id와 id는 client UPDATE 불가

### 8.3 `gps_points`

- `id uuid PK`
- `session_id uuid`, `user_id uuid`
- `sequence_no integer`
- `measured_at`, `received_at timestamptz`
- 좌표·정확도·고도·속도·방향 `double precision`, 선택값 nullable
- `schema_version`, `created_at`
- UNIQUE `(session_id, sequence_no)`
- UNIQUE `(id, session_id, user_id)`
- FK `(session_id, user_id)` → sessions ON DELETE CASCADE
- client UPDATE·DELETE 권한 없음

### 8.4 `measurement_events`

- `id uuid PK`, `session_id`, `user_id`
- `event_type`, `error_code`
- `occurred_at`, `received_at`
- 제한된 `details jsonb`, `schema_version`
- FK `(session_id, user_id)` → sessions ON DELETE CASCADE

### 8.5 `point_quality`

- PK `(point_id, algorithm_version)`
- `session_id`, `user_id`, `status`, `reasons text[]`
- `included_in_filtered_path`, `evaluated_at`
- FK `(point_id, session_id, user_id)` → gps_points ON DELETE CASCADE

### 8.6 `session_metrics`

- PK `(session_id, algorithm_version)`
- `user_id`, `quality_algorithm_version`
- duration, raw·filtered distance, speed와 pace
- altitude min·max, point counts, calculated_at
- FK `(session_id, user_id)` → sessions ON DELETE CASCADE

### 8.7 `user_data_deletion_cutoffs`

| 열 | 설명 |
|---|---|
| `user_id uuid PK` | Auth 사용자 |
| `reject_sessions_started_at_or_before timestamptz` | 이 시각 이전 세션 업로드 차단 |
| `requested_at timestamptz` | 요청 처리 시각 |
| `reason text` | user_request |

- FK user_id → auth.users ON DELETE CASCADE
- 사용자는 자기 cutoff SELECT만 가능
- INSERT·UPDATE·DELETE는 관리자 환경만 가능

### 8.8 삭제 후 재삽입 차단 trigger

`walk_sessions` BEFORE INSERT trigger는 현재 user의 cutoff를 조회한다. `new.started_at <= cutoff`이면 `SESSION_SUPPRESSED_BY_DELETION`으로 거부한다. 계정을 유지한 사용자의 cutoff 이후 새 세션은 허용한다.

이 방식은 서버에 한 번도 올라오지 않았던 과거 local session도 시작 시각 기준으로 차단한다. 기기 시계가 크게 잘못된 경우 새 세션이 잘못 차단되거나 오래된 세션이 통과할 수 있는 한계가 있으므로 삭제 완료 시 Safari local data 삭제 안내를 필수로 한다.

## 9. RLS와 보안

### 9.1 grant

- 모든 public 사용자 테이블 RLS 활성화
- anon과 authenticated 기존 grant revoke
- anon에는 사용자 데이터 권한 없음
- authenticated에는 필요한 SELECT·INSERT만 부여
- sessions는 `status`, `ended_at`, `updated_at` 열 update만 허용
- raw points에는 update·delete 없음
- client delete 정책 없음

### 9.2 정책

| 작업 | 조건 |
|---|---|
| SELECT | `auth.uid() is not null and auth.uid() = user_id` |
| INSERT | `with check (auth.uid() is not null and auth.uid() = user_id)` |
| sessions UPDATE | 기존·결과 모두 `auth.uid() = user_id` |
| DELETE | client 정책 없음 |

복합 FK가 자식 user ID와 session owner 불일치를 추가 차단한다.

### 9.3 키

브라우저 허용:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_KAKAO_MAP_JS_KEY`

브라우저 금지:

- Supabase Secret Key와 legacy Service Role Key
- 관리자 DB 연결 문자열
- 삭제 운영 자격 증명

### 9.4 pgTAP 검증

1. anon의 모든 사용자 테이블 접근 거부
2. A의 자기 데이터 SELECT·INSERT 허용
3. A의 B 데이터 접근·insert 거부
4. session user_id 변경 거부
5. raw point update·delete 거부
6. sessions 허용 열 update만 성공
7. 복합 FK 소유권 불일치 거부
8. cutoff 이전 session insert trigger 거부
9. cutoff 이후 같은 user 새 session 허용
10. A가 B cutoff 조회 불가

## 10. 자동 동기화

### 10.1 실행 trigger

- point 저장 후 10초 trailing debounce
- 미전송 point 20개 도달
- 측정 종료 직후
- 앱 시작 후 유효 session 복원
- `window.online`
- page visible 복귀

사용자용 전송 버튼은 P0에 없다. `navigator.onLine`은 힌트이며 요청 결과가 권위다.

### 10.2 시작 guard

1. 유효한 auth user 확인
2. 서버의 해당 user deletion cutoff 조회
3. local cutoff cache 갱신
4. 현재 user와 같은 owner의 pending 항목만 선택
5. `started_at <= cutoff` session과 자식을 `suppressed_by_deletion`으로 표시하고 제외
6. 다른 owner 항목은 `owner_mismatch`로 표시하고 제외

### 10.3 전송 순서

1. sessions insert 또는 종료 상태 update
2. gps_points와 measurement_events
3. completed·interrupted session의 point_quality와 session_metrics
4. 요청 ID를 서버에서 다시 SELECT
5. 존재가 확인된 항목만 confirmed

### 10.4 멱등성과 부분 실패

- client UUID가 server PK다.
- insert는 `ON CONFLICT DO NOTHING` 의미로 수행한다.
- raw 행은 update하지 않는다.
- GPS batch 기본 100개, 나머지 50개다.
- 실패 batch는 전체 pending/retry 상태로 두고 이전 성공 batch는 confirmed를 유지한다.
- session 실패 시 child를 전송하지 않는다.
- 응답 유실은 ID 재조회로 확인한다.

### 10.5 오류와 재시도

| 오류 | 처리 |
|---|---|
| network, 429, 5xx | 5초, 30초, 120초 최대 3회 후 retry_wait |
| 401 | token refresh 1회, 실패 시 auth_required |
| 403 | RLS·owner 오류, 자동 반복 안 함 |
| validation 4xx | failed, 자동 반복 안 함 |
| deletion trigger | cutoff 재조회, suppressed_by_deletion |

다음 app 시작·online·visible trigger에서 retry_wait를 다시 시도한다. Safari 종료 중에는 실행하지 않는다.

### 10.6 인증 만료와 계정 전환

- active measurement owner는 생성 시 user ID로 고정된다.
- token 만료 후 GPS local 저장은 계속한다.
- 같은 user가 재로그인하면 해당 user pending을 재개한다.
- 다른 user가 로그인하면 이전 user session을 목록·상세·sync에서 제외한다.
- owner user ID는 로그아웃이나 계정 전환으로 변경하지 않는다.

## 11. 거리·속도·품질

### 11.1 거리와 시간

- Haversine, 평균 지구 반지름 `6,371,008.8m`
- raw distance: sequence 연속 원본 좌표 합
- filtered distance: quality 포함 지점만 순서대로 연결
- duration: 정상 종료 `ended_at - started_at`
- interrupted: 마지막 received_at을 임시 계산 종료로 사용하되 상태 유지

### 11.2 속도와 페이스

- segment speed = 거리 ÷ measured_at 차이
- 시간 차가 0 이하이면 계산하지 않음
- avg speed = 거리 ÷ duration
- pace = `duration_s / (distance_m / 1000)` 초/km
- device speed는 별도 원본으로 유지

### 11.3 `quality-v1`

| 규칙 | 기준 | 결과 |
|---|---|---|
| invalid coordinate | 범위 밖·유한수 아님 | 제외 |
| low accuracy | accuracy > 50m | 제외 |
| stale position | received - measured > 30초 | 제외 |
| non-monotonic time | 직전 포함 지점 이하 시각 | 제외 |
| implausible walking speed | 직전 포함 지점 대비 > 3.5m/s | 제외 |
| 나머지 | 위 사유 없음 | 포함 |

원본은 변경하지 않는다. 정지 흔들림은 v1에서 완전히 제거하지 않으며 실제 데이터 검토 후 새 버전에서 개선한다.

### 11.4 고도

- null이 아닌 altitude의 최소·최대와 표본 수만 요약한다.
- 경사도·고도 보정은 하지 않는다.

## 12. 지도

- 카카오맵 공식 JavaScript SDK를 React wrapper 없이 사용한다.
- `autoload=false`와 `kakao.maps.load()`로 SDK를 비동기 로딩한다.
- JavaScript 키는 `VITE_KAKAO_MAP_JS_KEY` 환경변수로 주입한다.

| 데이터 | 지도 객체 | 표현 |
|---|---|---|
| raw points | marker | 정상 파랑, 낮은 정확도 주황, 튐·stale 빨강 |
| raw route | polyline | 회색 반투명 점선 |
| filtered route | polyline | 파랑 굵은 실선 |
| selected point | marker | 큰 크기·외곽선 |

- WGS84 좌표를 `LatLng(latitude, longitude)` 순서로 전달한다.
- point 선택 시 ID로 원본을 조회해 측정 시각과 정확도를 표시한다.
- attribution을 항상 표시한다.
- SDK 로딩 실패 시에도 텍스트 요약은 계속 제공한다.
- 도로 매칭·오프라인 타일·애니메이션은 구현하지 않는다.

## 13. 이벤트와 오류

### 13.1 이벤트 코드

- 측정: start_requested, started, stopped, interrupted
- Geolocation: permission_denied, position_unavailable, position_timeout, unsupported
- lifecycle: page_hidden, page_visible
- network: offline, online
- storage: local_save_failed
- auth: otp_send_failed, otp_verify_failed, auth_expired
- sync: failed, partial, confirmed, owner_mismatch, suppressed_by_deletion

### 13.2 Geolocation 오류

| 코드 | 처리 |
|---|---|
| 1 permission denied | watcher 종료, session error, 이벤트 저장 |
| 2 unavailable | 이벤트 저장, watcher 유지 |
| 3 timeout | 이벤트 저장, watcher 유지 |

브라우저 오류 메시지를 사용자에게 그대로 노출하지 않는다.

### 13.3 저장 오류

- Dexie 오류를 quota, transaction, database_unavailable, unknown으로 정규화한다.
- watcher는 유지하고 다음 콜백 저장을 시도한다.
- 저장 확인 전 point를 저장 완료 수에 포함하지 않는다.
- DB 전체 실패 시 같은 DB에 실패 이벤트를 남길 수 없는 한계를 화면 경고로 알린다.

### 13.4 로그 금지 정보

- OTP 원문
- access·refresh token
- 이메일 전체 주소
- 전체 GPS 좌표 배열

## 14. 개인정보 삭제와 재업로드 방지

### 14.1 요청 확인

1. 운영 연락 채널로 요청 접수
2. 요청 이메일과 Auth 계정 일치 확인
3. 필요 시 새 OTP 로그인으로 계정 접근 재확인
4. 대상 user UUID와 계정 유지·삭제 여부 확정

### 14.2 계정 유지 + 과거 기록 전체 삭제

신뢰할 수 있는 관리자 환경의 한 DB transaction에서 처리한다.

1. server current timestamp를 cutoff로 확정한다.
2. `user_data_deletion_cutoffs`에 user cutoff를 upsert한다.
3. `started_at <= cutoff`인 해당 user sessions를 삭제한다.
4. cascade로 points, session events, quality와 metrics를 삭제한다.
5. 대상 행 수와 cutoff 저장을 확인한다.

동기화 client는 cutoff를 먼저 내려받아 old local을 suppress한다. DB trigger도 old session 재삽입을 거부한다. cutoff 이후 새 수동 측정은 정상 허용한다.

### 14.3 인증 계정까지 삭제

1. 14.2의 위치 데이터 삭제를 먼저 완료한다.
2. Supabase 관리자 기능으로 Auth user를 삭제한다.
3. old local record의 owner UUID는 더 이상 인증할 수 없다.
4. 같은 이메일 재가입은 새 UUID이므로 old local과 owner가 일치하지 않는다.

### 14.4 로컬 데이터

서버는 Safari IndexedDB를 원격 삭제할 수 없다. 삭제 완료 안내에 Safari의 WalkLab 웹사이트 데이터 삭제 절차를 포함한다. 앱이 cutoff를 확인하면 old local을 일반 목록과 sync에서 제외하지만 물리 삭제는 사용자의 Safari 데이터 삭제로 완료한다.

### 14.5 한계

cutoff 방식은 client started_at에 의존한다. 기기 시계가 크게 잘못되면 판정 오류 가능성이 있다. 첫 MVP에서는 복잡한 기기별 삭제 원장 대신 cutoff + server trigger + Safari 로컬 삭제 안내를 사용한다.

## 15. 배포와 환경

### 15.1 환경변수

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_KAKAO_MAP_JS_KEY`
- `VITE_EMAIL_OTP_LENGTH=6`

OTP 길이 환경변수는 UX용이며 실제 허용 여부는 Supabase가 결정한다.

### 15.2 Vercel

- Vite build, output `dist`
- SPA 경로를 `index.html`로 rewrite
- HTTPS 고정 주소 사용
- source map 비공개 기본
- 카카오 JavaScript SDK 도메인을 운영 domain으로 제한

OTP는 링크 callback이 없으므로 auth redirect route는 필요하지 않다. Site URL은 production URL로 설정하되 로그인은 화면 내 OTP 검증으로 완료한다.

### 15.3 migration 관리

테이블, 제약, trigger, grant와 RLS는 Supabase migration 파일로 관리한다. 이 문서 작업에서는 migration을 작성하지 않는다.

## 16. 테스트

### 16.1 단위·로컬 DB

- OTP UI 상태 전이와 코드 메모리 삭제
- 로그인 guard
- Haversine·속도·페이스 경계
- quality-v1 임계값
- session owner 불변
- current user별 local query
- raw + sync item 원자 저장
- interrupted 복구
- cutoff suppress

### 16.2 RLS·DB

- 9.4의 10개 시나리오
- 반복 insert 중복 없음
- session cascade
- cutoff 이전 insert 차단·이후 허용

### 16.3 동기화 통합

- 저장 후 자동 scheduler
- 20 point·10초·종료 trigger
- session 실패 시 child 미전송
- partial batch
- 응답 유실 후 ID 확인
- auth 만료와 같은 user 재로그인
- 다른 user owner mismatch
- cutoff old local suppress

### 16.4 실제 iPhone Safari

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| IOS-01 | 신규 이메일 OTP 요청·검증 | 6자리 코드, 자동 user 생성, 홈 이동 |
| IOS-02 | 잘못된·만료 OTP와 발송 제한 | 오류 구분, OTP 미저장·미로그 |
| IOS-03 | 세션 복원·로그아웃 | 재접속 무인증, 로그아웃 후 보호 경로 차단 |
| IOS-04 | 로그인 없이 보호 URL | 로그인 화면 이동, GPS 미시작 |
| IOS-05 | 인터넷 없이 새 측정 | 시작 차단 |
| IOS-06 | 정상 10분 보행 수동 시작·종료 | 원본·요약·동기화·지도 |
| IOS-07 | 5분 정지 | 자동 종료 없음, 흔들림 원본 보존 |
| IOS-08 | 첫 GPS 전 권한 거부·timeout | session event, point 없음 |
| IOS-09 | 측정 중 비행기 모드 | local 저장 지속, pending |
| IOS-10 | 연결 복구 | 자동 sync, 중복 없음 |
| IOS-11 | 측정 중 token 만료 | 측정 지속, sync 보류, 같은 user 재로그인 후 전송 |
| IOS-12 | 측정 중 로그아웃 요청 | 종료 안내, 자동 종료·즉시 로그아웃 없음 |
| IOS-13 | A 측정 후 B 로그인 | A local 미노출·미전송 |
| IOS-14 | 새로고침·비정상 종료 | interrupted, 자동 GPS 재시작 없음 |
| IOS-15 | partial sync | confirmed·retry 분리 |
| IOS-16 | raw·filtered 지도 | 점 색, 두 경로, point 상세 |
| IOS-17 | 계정 유지 전체 삭제 후 old local 재접속 | old suppress, 서버 재삽입 차단, 새 측정 허용 |
| IOS-18 | Auth 계정 삭제 후 재가입 | 새 UUID, old local 미노출·미전송 |

실기기 결과에 iPhone 모델, iOS/Safari 버전, 앱 버전, 저전력 모드, 네트워크와 테스트 시각을 기록한다.

## 17. Python·iOS 호환성

- 서버 시간은 timestamptz UTC, 거리·고도는 m, 속도는 m/s, 방향은 degree다.
- null과 0을 구분한다.
- client UUID와 sequence로 순서를 복원한다.
- 원본, 이벤트, quality와 metrics를 별도 테이블로 유지한다.
- 알고리즘·schema·앱 버전을 저장한다.
- iOS 앱은 같은 Auth user ID와 PostgreSQL 계약을 사용하고 GPS collector만 Core Location으로 교체할 수 있다.

## 18. PRD 추적성

P0 요구사항 48개를 아래 범위로 모두 연결한다.

| PRD ID | SPEC |
|---|---|
| AUTH-001~007 | 4.1, 5장 |
| REC-001~008 | 6장, 13장 |
| LOC-001~005 | 7장, 10장 |
| SYNC-001~008 | 7.6, 10장 |
| HIST-001~003 | 4.1, 7.8, 10.6, 12장 |
| QUAL-001~004 | 7.5, 8.5~8.6, 11장 |
| MAP-001~005 | 12장 |
| SEC-001~005 | 7.8, 8.7~8.8, 9장, 14장 |
| DATA-001~003 | 7~8장, 11장, 13장, 17장 |

## 19. 위험과 불가능한 보장

- Safari 잠금·앱 전환 중 GPS 연속 수집은 보장할 수 없다.
- 브라우저가 전달하지 않은 지점을 복원할 수 없다.
- IndexedDB 삭제·회수·전체 장애 시 미동기화 원본 영구 보존을 보장할 수 없다.
- 진행 중 인증 만료 후 같은 user가 돌아오지 않으면 서버 동기화할 수 없다.
- Supabase hosted project의 실제 OTP 길이·만료 설정은 project 접근 없이 문서만으로 확인할 수 없다. 구현 전에 실제 설정을 조회해야 한다.
- 기본 Supabase 이메일 발송 제한은 반복 실기기 테스트에 매우 작으므로 Mailpit 또는 발송 간격 관리가 필요하다.
- deletion cutoff는 client 시계에 의존한다.
- quality-v1은 정지 흔들림을 완전히 제거하지 않는다.
- 7일 범위에서 가장 큰 위험은 OTP 설정, 실제 Safari GPS, RLS, 자동 sync와 deletion cutoff의 결합이다.

## 20. 공식 참고 문서

- [Supabase Passwordless Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
- [Supabase verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Auth Rate Limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase CLI Email OTP 설정](https://supabase.com/docs/guides/local-development/cli/config)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [W3C Geolocation](https://www.w3.org/TR/geolocation/)
- [WebKit Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Dexie API](https://dexie.org/docs/API-Reference)
- [카카오 지도 Web API](https://apis.map.kakao.com/web/)
- [Vite Static Deploy](https://vite.dev/guide/static-deploy.html)

## 21. 현재 구현 부록과 후속 명세 (2026-10-30)

### 21.1 P0 이후 구현된 분석

- G6 `movement-v1`은 `quality-v1` 결과를 재사용해 이동·정지·판정 불가 시간과 이동 중 평균속도를 결정적으로 계산한다. GPS 원본과 `metrics-v1` 결과는 변경하지 않는다. 세부 기준은 `docs/G6_MOVEMENT_ANALYSIS.md`를 따른다.
- G7 `recency-weighted-v1`은 세션별 이동 중 평균속도를 하나의 학습 단위로 사용한다. 최근 30일을 우선하고 데이터가 부족하면 90일까지 확대하며, 시간 감쇠와 세션별 최대 가중치를 적용한다. 결과는 기존 기록에서 다시 계산할 수 있으며 새 DB 테이블을 요구하지 않는다. 세부 기준은 `docs/G7_WALKING_SPEED_MODEL.md`를 따른다.
- G1~G7은 구현과 실기기 검증을 완료했다. G7은 신규 보행 세션 동기화 후 추정속도와 가중치가 자동 갱신되는 종단 흐름까지 확인했다.

### 21.2 G8 이후 기술 경계

- G8~G17의 단계별 설계와 외부 API 검증 상태는 `docs/SMART_ARRIVAL_SPEC.md`에서 관리한다.
- ETA 계산은 기본 도보시간, 신호 대기, 대중교통 구간, 경사도 보정, 날씨 보정을 독립된 구성요소로 분리한다.
- 경사도와 날씨는 기본 도보시간을 만드는 보행속도에 한 번만 반영하고 별도 시간을 중복 가산하지 않는다.
- 실시간 대중교통 값은 같은 항목의 시간표 기반 값을 대체하며 두 값을 더하지 않는다.
- 외부 API 비밀 키 또는 여러 공급자 응답의 서버 측 조합이 필요할 때만 BFF·서버리스 함수·FastAPI 도입을 별도 결정한다. 현재 P0 프런트엔드에 비밀 키를 추가하지 않는다.
