import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../features/auth/AuthProvider'
import {
  GuestOnlyRoute,
  ProtectedRoute,
} from '../features/auth/AuthRouteGuards'
import { HistoryPage } from '../pages/HistoryPage'
import { LoginPage } from '../pages/LoginPage'
import { SessionDetailPage } from '../pages/SessionDetailPage'
import { WalkingRoutePage } from '../pages/WalkingRoutePage'
import { MeasurementProvider } from '../features/measurement/MeasurementProvider'
import { SyncProvider } from '../features/sync/SyncProvider'
import { DeveloperToolsPage } from '../pages/DeveloperToolsPage'
import { HomePage } from '../pages/HomePage'
import { WalkingAnalysisPage } from '../pages/WalkingAnalysisPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/summary" element={<WalkingAnalysisPage />} />
        <Route path="/walking-route" element={<WalkingRoutePage />} />
        <Route
          path="/transit-route"
          element={<Navigate to="/walking-route?mode=transit" replace />}
        />
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/developer-tools" element={<DeveloperToolsPage />} />
      </Route>
    </Routes>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SyncProvider>
          <MeasurementProvider>
            <AppRoutes />
          </MeasurementProvider>
        </SyncProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
