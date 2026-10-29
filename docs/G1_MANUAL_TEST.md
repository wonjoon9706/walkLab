# G1 이메일 OTP 수동 테스트

이 절차는 자동 테스트와 구분되는 실제 Supabase·Resend 이메일 검증이다. Resend에서 허용한 본인 이메일만 사용하고, 발송 제한을 피하기 위해 아래 순서로 최소 횟수만 요청한다.

## 1. 테스트 전 Supabase 확인

Supabase Dashboard에서 다음 항목을 실제로 확인한다.

1. `Authentication > Providers > Email`에서 Email provider가 활성화되어 있는지 확인한다.
2. `Authentication > Email Templates > Magic Link or OTP` 본문에 `{{ .Token }}`이 있는지 확인한다.
3. 같은 템플릿에서 `{{ .ConfirmationURL }}` 링크가 제거됐는지 확인한다.
4. Email OTP 길이가 6자리인지 확인한다.
5. Email OTP 만료가 3,600초인지 확인한다.
6. `Authentication > Rate Limits`에서 이메일 발송과 OTP 검증 제한을 확인한다.
7. `Authentication > URL Configuration`의 Site URL을 `https://walk-lab.vercel.app`로 확인한다.
8. Resend SMTP 설정과 허용된 수신 이메일을 확인한다.

Dashboard 메뉴 이름이 다르면 Supabase의 Email OTP, Email Templates, Redirect URLs와 Rate Limits 공식 문서에서 현재 위치를 확인한다.

## 2. 최소 이메일 발송으로 정상·오류 확인

1. 기존 WalkLab 세션에서 로그아웃한다.
2. `/login`을 열고 Resend에서 허용한 본인 이메일을 입력한다.
3. `인증번호 받기`를 한 번만 누른다.
4. Gmail에서 메일 본문에 6자리 숫자가 있고 로그인 링크가 없는지 확인한다.
5. 실제 코드를 사용하기 전에 틀린 6자리 숫자를 한 번만 입력해 오류 안내를 확인한다.
6. 같은 메일의 올바른 코드를 입력해 로그인한다.
7. 측정 홈에서 Supabase user ID가 표시되는지 확인한다.
8. 새로고침 후 로그인 상태가 유지되는지 확인한다.
9. 로그아웃한 뒤 `/`, `/history`, `/sessions/test-session`을 직접 열어 `/login`으로 이동하는지 확인한다.

틀린 코드 검증이 실제 코드의 유효성을 없애면 재요청 대기 시간이 끝난 뒤 한 번만 다시 요청한다. 발송 제한을 확인하려고 버튼을 반복해서 누르지 않는다.

## 3. 신규 가입 템플릿 확인

- Supabase Auth에 아직 없는 이메일로 최초 요청할 때 어떤 템플릿이 발송되는지 확인한다.
- 현재 Resend 정책상 본인 이메일만 받을 수 있다면, 해당 이메일로 사용자가 만들어지기 전 첫 테스트에서 확인한다.
- `Confirm sign up` 템플릿이나 링크 이메일이 오면 임시로 링크를 클릭해 우회하지 않는다.
- Dashboard의 Auth 로그와 Email Templates를 확인해 실제 사용된 템플릿을 찾고 `{{ .Token }}` 기반 OTP로 수정한 뒤 다시 테스트한다.

## 4. 만료와 발송 제한

- 만료 오류는 자동 테스트로 먼저 검증한다.
- 실제 3,600초 만료 테스트는 시간이 많이 들고 추가 발송을 사용하므로 별도 검증 항목으로 남겨도 된다.
- 실제 발송 제한은 Dashboard 설정값과 Auth 로그로 확인하고, 제한을 일부러 소진하지 않는다.
- UI의 재요청 버튼은 요청 성공 후 60초 동안 비활성화되는지 확인한다.

## 5. 기기별 확인

### Windows Chrome

- 이메일 자동 완성
- 잘못된 코드와 정상 코드
- 새로고침 세션 유지
- 로그아웃과 보호 route 차단

### iPhone Safari

- 화면이 가로로 넘치지 않는지 확인
- 이메일 자동 완성이 동작하는지 확인
- OTP 입력 시 숫자 키패드가 열리는지 확인
- Mail 또는 Gmail에서 돌아왔을 때 `one-time-code` 자동 완성이 제안되는지 확인
- 새로고침 후 로그인 상태가 유지되는지 확인
- 앱 진입만으로 위치 권한 요청이 나타나지 않는지 확인

## 6. 완료 판정

다음 항목은 실제 확인 전까지 완료로 표시하지 않는다.

- Resend SMTP를 통한 6자리 코드 수신
- 링크가 아닌 OTP 템플릿 사용
- 신규 사용자 생성과 로그인
- Windows Chrome 세션 복원
- iPhone Safari 세션 복원과 보호 route 차단
- 실제 Supabase OTP 길이·만료·발송 제한 설정

## 공식 참고 문서

- [Supabase Passwordless Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Auth Rate Limits](https://supabase.com/docs/guides/auth/rate-limits)
