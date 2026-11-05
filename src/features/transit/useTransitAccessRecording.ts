import { useCallback, useEffect, useState } from 'react'
import { useMeasurement } from '../measurement/measurementContext'
import { useSync } from '../sync/syncContext'
import { localMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import { createTransitAccessRecording } from '../../services/navigation/transitAccessRecording'
import type { StartLiveNavigationInput } from '../../domain/liveNavigation'
import type { TransitBoardingTarget } from '../../services/navigation/transitAccessArrival'
import { useLiveNavigation } from '../navigation/useLiveNavigation'

export function useTransitAccessRecording() {
  const measurement = useMeasurement()
  const sync = useSync()
  const navigation = useLiveNavigation()
  const { startWithPositionSource, stop } = navigation
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
  useEffect(() => {
    if (state.phase !== 'recording') stop()
  }, [state.phase, stop])
  const start = useCallback(async (routeId: string, target: TransitBoardingTarget | null, input?: StartLiveNavigationInput) => {
    await controller.start(routeId, target)
    const recording = controller.getState()
    if (recording.phase === 'recording' && recording.routeId === routeId && input !== undefined) {
      // 기록 서비스의 GPS 구독만 추가한다. watchPosition과 저장 세션은 G2 한 개를 공유한다.
      startWithPositionSource(input, { subscribe: measurement.subscribeGps })
    }
  }, [controller, measurement.subscribeGps, startWithPositionSource])
  const finish = useCallback(() => {
    stop()
    return controller.finish('manual')
  }, [controller, stop])
  return { state, isActive, start, finish, navigation }
}
