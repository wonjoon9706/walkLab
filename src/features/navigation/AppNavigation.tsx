import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/authContext'
import { useMeasurement } from '../measurement/measurementContext'
import { getAuthErrorMessage } from '../../services/auth/authErrorMessage'

interface AppNavigationProps {
  children: ReactNode
}

export function AppNavigation({ children }: AppNavigationProps) {
  const { status: authStatus, signOut } = useAuth()
  const measurement = useMeasurement()
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOut() {
    setSignOutError(null)
    try {
      await signOut()
    } catch (error) {
      setSignOutError(getAuthErrorMessage(error, 'signOut'))
    }
  }

  return (
    <div className="app-frame">
      <header className="app-header">
        <NavLink className="app-brand" to="/walking-route">
          WalkLab
        </NavLink>
        <details className="settings-menu">
          <summary aria-label="설정 메뉴">설정</summary>
          <div className="settings-menu-panel">
            <NavLink to="/developer-tools">개발자 도구</NavLink>
            <button
              type="button"
              className="text-button"
              disabled={measurement.isActive}
              onClick={() => void handleSignOut()}
            >
              로그아웃
            </button>
            {measurement.isActive && (
              <small>안내 또는 측정을 종료한 뒤 로그아웃할 수 있습니다.</small>
            )}
          </div>
        </details>
      </header>

      {authStatus !== 'authenticated' && measurement.isActive && (
        <p className="global-alert error-message" role="alert">
          로그인 세션이 만료됐지만 GPS와 로컬 저장은 계속됩니다. 측정을 종료한 뒤
          다시 로그인해 주세요.
        </p>
      )}
      {signOutError !== null && (
        <p className="global-alert error-message" role="alert">
          {signOutError}
        </p>
      )}

      {children}

      <nav className="primary-navigation" aria-label="주요 메뉴">
        {measurement.isActive && measurement.mode === 'manual' ? (
          <span aria-disabled="true">도보 길찾기</span>
        ) : (
          <NavLink to="/walking-route">도보 길찾기</NavLink>
        )}
        {measurement.isActive ? (
          <span aria-disabled="true">내 보행 기록</span>
        ) : (
          <NavLink to="/history">내 보행 기록</NavLink>
        )}
      </nav>
    </div>
  )
}
