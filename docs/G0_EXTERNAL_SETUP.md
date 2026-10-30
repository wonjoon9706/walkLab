# G0 외부 서비스 설정 체크리스트

이 문서의 항목은 개발자가 각 서비스 화면에서 직접 확인해야 합니다. 현재 저장소만으로 확인할 수 없으며, 실제 확인 전에는 완료로 처리하지 않습니다.

## Supabase

- [ ] Supabase 프로젝트를 생성한다.
- [ ] Project Settings의 API 설정에서 Project URL과 Publishable Key를 확인한다.
- [ ] 값을 로컬 `.env.local`과 Vercel 환경변수에 각각 등록한다.
- [ ] Authentication에서 Email provider를 활성화한다.
- [ ] `Magic Link or OTP` 이메일 템플릿 본문에 `{{ .Token }}`을 넣는다.
- [ ] 이메일 템플릿에서 `{{ .ConfirmationURL }}`을 제거해 매직 링크가 발송되지 않게 한다.
- [ ] 실제 프로젝트의 Email OTP 길이가 6자리인지 확인한다.
- [ ] Email OTP 만료 시간이 3,600초인지 확인한다.
- [ ] OTP 재요청 간격과 프로젝트 이메일 발송 제한을 확인한다.
- [ ] 개발·preview·production URL을 Site URL과 허용 URL에 등록한다.
- [ ] 초기 테스트 이메일이 기본 이메일 제공자의 발송 대상인지 확인한다.

브라우저에는 Publishable Key만 사용합니다. Secret Key, Service Role Key와 관리자 DB 접속 정보는 요청하거나 저장하지 않습니다.

## 카카오맵

- [ ] 카카오디벨로퍼스 앱을 준비하고 카카오맵 API를 활성화한다.
- [ ] JavaScript 키를 `VITE_KAKAO_MAP_JS_KEY`에 등록한다.
- [ ] 로컬 및 Vercel production 주소를 JavaScript SDK 도메인에 등록한다.
- [ ] 지도 attribution 표시 조건을 확인한다.

G0에서는 환경변수 주입 경로만 준비합니다. 실제 지도 렌더링은 G6에서 구현합니다.

## Vercel

- [ ] Git 저장소를 연결해 Vercel 프로젝트를 만든다.
- [ ] Framework Preset을 Vite로 확인한다.
- [ ] Build Command를 `npm run build`로 확인한다.
- [ ] Output Directory를 `dist`로 확인한다.
- [ ] preview와 production 환경에 공개 환경변수를 각각 등록한다.
- [ ] production URL을 Supabase Site URL·허용 URL에 반영한다.
- [ ] `/history`와 `/sessions/test-id` 직접 접근이 `index.html`로 rewrite되는지 확인한다.
- [ ] iPhone Safari에서 HTTPS preview URL과 네 route shell을 확인한다.
- [ ] 페이지를 여는 것만으로 위치 권한 요청이 나타나지 않는지 확인한다.

Vercel 배포와 계정 설정은 개발자가 직접 수행합니다. 현재 G0 작업에서는 외부 계정을 변경하거나 실제 배포하지 않습니다.
