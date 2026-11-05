import { useEffect, useState } from 'react'
import { useMeasurement } from '../measurement/measurementContext'
import { useSync } from '../sync/syncContext'
import { localMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import { createTransitAccessRecording } from '../../services/navigation/transitAccessRecording'

export function useTransitAccessRecording() {
  const measurement = useMeasurement()
  const sync = useSync()
  const [controller] = useState(() => createTransitAccessRecording({
    measurement,
    repository: localMeasurementRepository,
    now: () => Date.now(),
    createId: () => crypto.randomUUID(),
  }))
  useEffect(() => controller.updateMeasurement(measurement), [controller, measurement])
  const [state, setState] = useState(controller.getState)
  useEffect(() => {
    const unsubscribe = controller.subscribe(setState)
    const visibility = () => controller.setVisible(document.visibilityState === 'visible')
    visibility()
    document.addEventListener('visibilitychange', visibility)
    const timer = window.setInterval(() => controller.tick(), 5_000)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', visibility)
      window.clearInterval(timer)
      controller.dispose()
    }
  }, [controller])
  useEffect(() => {
    if (state.phase === 'saved') void controller.verifySaved()
  }, [controller, state.phase, sync.status, sync.lastSyncedAt])
  useEffect(() => {
    if (state.phase === 'recording' && measurement.sessionId === state.sessionId &&
      (measurement.status === 'completed' || measurement.status === 'error' || measurement.status === 'interrupted')) {
      void controller.finish('manual')
    }
  }, [controller, state.phase, state.sessionId, measurement.sessionId, measurement.status])
  const isActive = state.phase === 'starting' || state.phase === 'recording' || state.phase === 'stopping'
  return { state, isActive, start: controller.start, finish: () => controller.finish('manual') }
}
