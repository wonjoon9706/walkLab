import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './authContext'
import { useMeasurement } from '../measurement/measurementContext'

function AuthLoadingPage() {
  return (
    <main className="page-shell" aria-live="polite">
      <p className="eyebrow">WalkLab</p>
      <h1>로그인 상태 확인 중</h1>
      <p>잠시만 기다려 주세요.</p>
    </main>
  )
}

export function ProtectedRoute() {
  const { status } = useAuth()
  const { isActive } = useMeasurement()
  const location = useLocation()

  if (status === 'initializing') {
    return <AuthLoadingPage />
  }

  if (isActive && location.pathname !== '/') {
    return <Navigate to="/" replace />
  }

  // 진행 중 인증이 만료돼도 현재 측정 화면은 로컬 저장을 계속한다.
  if (status !== 'authenticated' && !(isActive && location.pathname === '/')) {
    const requestedPath = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from: requestedPath }} />
  }

  return <Outlet />
}

export function GuestOnlyRoute() {
  const { status } = useAuth()
  const { isActive } = useMeasurement()

  if (status === 'initializing') {
    return <AuthLoadingPage />
  }

  if (status === 'authenticated' || isActive) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
