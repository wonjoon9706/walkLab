import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './authContext'

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
  const location = useLocation()

  if (status === 'initializing') {
    return <AuthLoadingPage />
  }

  if (status !== 'authenticated') {
    const requestedPath = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from: requestedPath }} />
  }

  return <Outlet />
}

export function GuestOnlyRoute() {
  const { status } = useAuth()

  if (status === 'initializing') {
    return <AuthLoadingPage />
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
