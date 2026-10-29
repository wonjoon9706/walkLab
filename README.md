# WalkLab

WalkLab 첫 MVP의 React + TypeScript 웹앱입니다. 현재 G1 이메일 OTP 인증과 보호 route까지 구현되어 있습니다. GPS 수집, 동기화와 지도 기능은 아직 구현하지 않습니다.

## 개발 환경

- Node.js 22.12 이상
- npm
- Windows + VS Code
- 실제 검증 기기: iPhone Safari

PowerShell 실행 정책 때문에 `npm` 명령이 차단되면 시스템 설정을 변경하지 않고 `npm.cmd`를 사용합니다.

## 시작하기

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

`.env.local`의 예시 값을 실제 공개 설정으로 교체합니다. Secret Key와 Service Role Key는 브라우저 환경변수에 넣지 않습니다.

## 검증 명령

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

외부 서비스 설정 순서는 [G0 외부 서비스 체크리스트](docs/G0_EXTERNAL_SETUP.md)를 참고합니다.

실제 이메일 OTP 검증은 [G1 수동 테스트 안내](docs/G1_MANUAL_TEST.md)를 참고합니다.
