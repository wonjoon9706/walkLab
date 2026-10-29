# G3 데이터베이스 적용 및 검증

## 범위

이 문서는 `20261029000100_create_walklab_schema.sql` migration을 Supabase에 적용하고 G3 보안 경계를 확인하는 절차다. G4 자동 동기화는 포함하지 않는다.

브라우저 사용자는 자기 데이터만 조회·삽입할 수 있다. `walk_sessions`는 `status`, `ended_at`, `updated_at`만 수정할 수 있다. 원본 GPS와 이벤트·파생 데이터에는 브라우저 UPDATE·DELETE 권한이 없다. 개인정보 전체 삭제는 향후 운영자용 수동 절차로 처리한다.

## 원격 적용 전 영향

- public schema에 사용자 데이터 테이블 6개가 추가된다.
- 모든 테이블에 RLS가 활성화된다.
- 기존 Auth 사용자는 삭제하거나 변경하지 않는다.
- 아직 G4가 없으므로 적용 직후에도 웹앱이 서버에 GPS를 전송하지 않는다.
- migration은 기존 테이블이 없는 첫 적용을 전제로 한다. 같은 이름의 수동 테이블이 이미 있다면 적용하지 말고 먼저 구조를 비교한다.

## 로컬 검증

Docker Desktop을 실행한 뒤 프로젝트 루트에서 다음 명령을 순서대로 실행한다.

```powershell
npx supabase start
npx supabase db reset
npx supabase test db
```

`db reset`은 로컬 Supabase DB만 초기화한다. 연결된 원격 프로젝트에는 영향을 주지 않는다.

검증이 끝나면 다음 명령으로 로컬 컨테이너를 중지할 수 있다.

```powershell
npx supabase stop
```

## 원격 프로젝트 적용

원격 DB 변경은 migration 검토와 사용자 승인 후에만 실행한다.

1. Supabase Dashboard의 **Table Editor**에서 같은 이름의 테이블이 없는지 확인한다.
2. 로컬에서 `npx supabase db reset`과 `npx supabase test db`가 모두 성공했는지 확인한다.
3. 아직 프로젝트가 연결되지 않았다면 `npx supabase login` 후 Dashboard URL의 project ref를 사용해 `npx supabase link --project-ref <PROJECT_REF>`를 실행한다.
4. `npx supabase db push --dry-run`으로 적용될 migration이 이 파일 하나인지 확인한다. dry run은 원격 스키마를 변경하지 않는다.
5. 사용자 승인 후 프로젝트 루트에서 `npx supabase db push`를 실행한다.
6. Dashboard의 **Table Editor**에서 6개 테이블을 확인한다.
7. 각 테이블의 **RLS policies**에서 RLS가 켜져 있고 `anon` 정책이 없는지 확인한다.

`db push`는 원격 데이터베이스를 변경하므로 이 문서 작성 단계에서는 실행하지 않는다.

## 원격 보안 확인

로컬 pgTAP 검증 외에 서로 다른 테스트 계정 A와 B로 다음을 확인한다.

1. A의 access token으로 A session insert와 select가 성공한다.
2. A의 token으로 B `user_id` session insert가 거부된다.
3. B가 만든 session ID를 A가 직접 select해도 결과가 0건이다.
4. A의 token으로 B session에 GPS point를 넣으면 RLS 또는 복합 FK로 거부된다.
5. GPS point UPDATE와 DELETE가 권한 오류로 거부된다.
6. session의 `status`, `ended_at`, `updated_at`만 수정할 수 있다.
7. 일반 로그인 사용자는 deletion cutoff를 조회만 할 수 있고 변경할 수 없다.

Dashboard SQL Editor는 관리자 권한으로 실행되어 RLS를 우회할 수 있다. 사용자별 RLS 확인에는 SQL Editor 결과만 사용하지 말고 실제 사용자 JWT를 사용하는 Data API 또는 로컬 pgTAP 테스트를 사용한다.

## 삭제 cutoff의 한계

삭제 cutoff는 서버가 기록한 기준 시각과 client의 `started_at`을 비교한다. 기기 시계가 크게 틀리면 오래된 기록이 통과하거나 새 기록이 잘못 차단될 수 있으므로 완전한 재업로드 차단을 보장하지 않는다. 개인정보 삭제 완료 시 Safari의 WalkLab 사이트 데이터도 사용자가 직접 삭제하도록 안내해야 한다.
