# G4 실제 동기화 검증 절차

## 테스트 데이터 범위

기존 보행 기록은 수정하거나 삭제하지 않는다. 실제 검증에는 테스트 계정으로 새로 만든 짧은 세션만 사용하고, 시작 전에 session ID를 기록한다. 이 구현 작업에서는 원격 Supabase에 테스트 데이터를 생성하지 않았다.

테스트 행을 정리해야 한다면 브라우저에 관리자 키를 넣지 않는다. 검증이 끝난 뒤 Supabase 관리자 환경에서 기록한 session ID의 소유자를 다시 확인하고 해당 테스트 session만 삭제한다. `ON DELETE CASCADE`가 GPS 지점과 이벤트를 함께 정리한다.

## Windows Chrome

1. 로그인 후 30초 정도 측정하고 종료한다.
2. 화면의 서버 동기화 상태가 `동기화 완료`가 되는지 확인한다.
3. Supabase Table Editor에서 같은 session ID의 `walk_sessions` 한 행, `gps_points` 여러 행, `measurement_events` 행을 확인한다.
4. `measured_at`과 `received_at`, null 고도·속도 필드가 로컬 원본과 같은지 확인한다.
5. 새로고침과 화면 재활성화를 반복해도 각 UUID와 `(session_id, sequence_no)`별 행 수가 늘지 않는지 확인한다.
6. 측정 중 네트워크를 끊고 지점 수가 늘어나는 것을 확인한 뒤 연결을 복구한다. 로컬 원본이 유지되고 나중에 서버에 들어오는지 확인한다.

## iPhone Safari

1. HTTPS Production에서 로그인하고 측정을 시작한다.
2. 측정 중 비행기 모드를 켠 상태에서도 로컬 저장 지점 수가 늘어나는지 확인한다.
3. 비행기 모드를 끄고 Safari를 다시 전면으로 가져왔을 때 자동 동기화가 시작되는지 확인한다.
4. 측정 종료 직후 남은 항목이 자동 전송되는지 확인한다.
5. Safari를 새로 열었을 때 미전송 항목이 자동 재처리되는지 확인한다.
6. 동기화 중 화면 잠금이나 Safari 종료 시 실행 지속을 기대하지 않고, 다시 접속했을 때 복구되는지만 확인한다.

## 사용자별 RLS 검증

테스트 계정 A와 B를 분리해 다음을 확인한다.

1. A로 생성한 session ID와 point ID를 기록한다.
2. B의 정상 로그인 세션으로 A의 ID를 SELECT하면 0건이어야 한다.
3. B의 정상 로그인 세션으로 A의 session ID에 point를 INSERT하면 RLS 또는 복합 FK 오류가 발생해야 한다.
4. A와 B 어느 쪽에서도 GPS 원본 UPDATE·DELETE가 허용되면 안 된다.
5. Dashboard SQL Editor는 관리자 권한으로 RLS를 우회할 수 있으므로 사용자 JWT 검증 결과로 사용하지 않는다.

JWT 원문, refresh token, 전체 GPS 좌표 배열은 콘솔이나 테스트 보고서에 출력하지 않는다.
