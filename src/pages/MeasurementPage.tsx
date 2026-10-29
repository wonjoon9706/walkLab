import {
  findMissingEnvironmentVariables,
  publicEnvironment,
} from '../app/env'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/authContext'
import { getAuthErrorMessage } from '../services/auth/authErrorMessage'

export function MeasurementPage() {
  const { user, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const missingVariables = findMissingEnvironmentVariables(publicEnvironment)
  const isEnvironmentReady = missingVariables.length === 0

  async function handleSignOut() {
    setSignOutError(null)

    try {
      await signOut()
    } catch (error) {
      setSignOutError(getAuthErrorMessage(error, 'signOut'))
    }
  }

  return (
    <main className="page-shell">
      <p className="eyebrow">WalkLab</p>
      <h1>측정 홈</h1>
      <p>GPS 측정 기능은 G2에서 구현할 예정입니다.</p>

      <section className="status-card" aria-labelledby="account-title">
        <h2 id="account-title">로그인 계정</h2>
        <p>사용자 ID: {user?.id ?? '확인할 수 없음'}</p>
        {user?.email !== null && <p>이메일: {user?.email}</p>}
        <div className="button-row">
          <Link className="link-button" to="/history">
            기록 목록
          </Link>
          <button
            className="secondary-button"
            type="button"
            onClick={handleSignOut}
          >
            로그아웃
          </button>
        </div>
        {signOutError !== null && (
          <p className="auth-message error-message" role="alert">
            {signOutError}
          </p>
        )}
      </section>

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
