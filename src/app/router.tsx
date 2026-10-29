import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { HistoryPage } from '../pages/HistoryPage'
import { LoginPage } from '../pages/LoginPage'
import { MeasurementPage } from '../pages/MeasurementPage'
import { SessionDetailPage } from '../pages/SessionDetailPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<MeasurementPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
    </Routes>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
