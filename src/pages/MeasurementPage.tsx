import {
  findMissingEnvironmentVariables,
  publicEnvironment,
} from '../app/env'

export function MeasurementPage() {
  const missingVariables = findMissingEnvironmentVariables(publicEnvironment)
  const isEnvironmentReady = missingVariables.length === 0

  return (
    <main className="page-shell">
      <p className="eyebrow">WalkLab</p>
      <h1>측정 홈</h1>
      <p>GPS 측정 기능은 G2에서 구현할 예정입니다.</p>

      <section className="status-card" aria-labelledby="environment-title">
        <h2 id="environment-title">외부 서비스 설정</h2>
        {isEnvironmentReady ? (
          <p>공개 환경변수 이름이 모두 설정되어 있습니다.</p>
        ) : (
          <p>
            아직 설정되지 않은 항목: {missingVariables.join(', ')}
          </p>
        )}
      </section>
    </main>
  )
}
