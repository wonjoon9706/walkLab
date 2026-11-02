import { Navigate } from 'react-router-dom'
import { useMeasurement } from '../features/measurement/measurementContext'
import { MeasurementPage } from './MeasurementPage'

export function HomePage() {
  const measurement = useMeasurement()

  // 진행 중인 수동 측정은 기존 / 화면을 유지하고, 평상시 홈은 길찾기로 연결한다.
  if (measurement.isActive && measurement.mode === 'manual') {
    return <MeasurementPage />
  }

  return <Navigate to="/walking-route" replace />
}
