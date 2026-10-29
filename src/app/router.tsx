import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../features/auth/AuthProvider'
import {
  GuestOnlyRoute,
  ProtectedRoute,
} from '../features/auth/AuthRouteGuards'
import { HistoryPage } from '../pages/HistoryPage'
import { LoginPage } from '../pages/LoginPage'
import { MeasurementPage } from '../pages/MeasurementPage'
import { SessionDetailPage } from '../pages/SessionDetailPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<MeasurementPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
      </Route>
    </Routes>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
