import type { MeasurementContextValue } from '../../features/measurement/measurementContext'
import type { LocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import { createTransitAccessArrivalDetector, isValidTransitBoardingTarget, transitAccessArrivalPolicy, type TransitBoardingTarget } from './transitAccessArrival'

export interface TransitAccessRecordingState {
  phase: 'idle' | 'starting' | 'recording' | 'stopping' | 'saved' | 'error'
  guidanceId: string | null
  routeId: string | null
  sessionId: string | null
  target: TransitBoardingTarget | null
  currentPosition: GeoCoordinate | null
  distanceM: number | null
  gps: 'waiting' | 'receiving' | 'inaccurate' | 'stale' | 'hidden' | 'error'
  stopReason: 'arrival' | 'manual' | null
  savedPointCount: number
  serverSync: 'pending' | 'confirmed'
  message: string | null
}

interface Dependencies {
  measurement: Pick<MeasurementContextValue, 'startMeasurement' | 'stopMeasurement' | 'subscribeGps' | 'getMeasurementState'>
  repository: Pick<LocalMeasurementRepository, 'getSession' | 'listPoints' | 'listSyncItems'>
  now(): number
  createId(): string
}

export function createTransitAccessRecording(dependencies: Dependencies) {
  let measurementService = dependencies.measurement
  let state: TransitAccessRecordingState = {
    phase: 'idle', guidanceId: null, routeId: null, sessionId: null, target: null,
    currentPosition: null, distanceM: null, gps: 'waiting', stopReason: null,
    savedPointCount: 0, serverSync: 'pending', message: null,
  }
  const listeners = new Set<(value: TransitAccessRecordingState) => void>()
  let ownerId: string | null = null
  let unsubscribeGps: (() => void) | null = null
  let detector = createTransitAccessArrivalDetector(null, 0)
  let stopRequested = false
  let stopPromise: Promise<void> | null = null
  let startPromise: Promise<void> | null = null
  let visible = true
  let freshAfter = 0
  let lastReceivedAt = 0
  let run = 0

  function publish(change: Partial<TransitAccessRecordingState>) {
    state = { ...state, ...change }
    listeners.forEach((listener) => listener(state))
  }

  async function verifySaved() {
    const sessionId = state.sessionId
    if (sessionId === null || ownerId === null) return
    const currentRun = run
    try {
      const [session, points, syncItems] = await Promise.all([
        dependencies.repository.getSession(ownerId, sessionId),
        dependencies.repository.listPoints(ownerId, sessionId),
        dependencies.repository.listSyncItems(ownerId),
      ])
      if (currentRun !== run) return
      const measurement = measurementService.getMeasurementState()
      if (session?.status !== 'completed' || session.endedAt === null ||
        (measurement.sessionId === sessionId && (measurement.failedSaveCount > 0 || measurement.localSaveStatus === 'failed'))) {
        publish({ phase: 'error', message: '기록 저장을 완전히 확인하지 못했습니다. 저장된 원본은 유지됩니다. 내 보행 기록에서 확인해 주세요.' })
        return
      }
      const items = syncItems.filter((item) => item.sessionId === sessionId)
      publish({
        phase: 'saved', savedPointCount: points.length,
        serverSync: items.length > 0 && items.every((item) => item.state === 'confirmed') ? 'confirmed' : 'pending',
        message: points.length === 0 ? '수집된 GPS 위치 없이 안내가 종료되었습니다.' : null,
      })
    } catch {
      if (currentRun === run) publish({ phase: 'error', message: '로컬 저장 상태를 확인하지 못했습니다. 기존 기록을 삭제하지 않았습니다.' })
    }
  }

  function finish(reason: 'arrival' | 'manual'): Promise<void> {
    if (stopPromise !== null) return stopPromise
    stopRequested = true
    if (state.phase === 'starting' && startPromise !== null) {
      return startPromise.then(() => finish(reason))
    }
    if (state.phase !== 'recording') return Promise.resolve()
    publish({ phase: 'stopping', stopReason: reason })
    unsubscribeGps?.()
    unsubscribeGps = null
    stopPromise = (async () => {
      try {
        const current = measurementService.getMeasurementState()
        // 다른 사용자나 다른 기록이 시작됐다면 그 기록을 종료하지 않는다.
        if (current.sessionId !== state.sessionId || current.ownerUserId !== ownerId) {
          publish({ phase: 'error', message: '현재 기록이 변경되어 자동 종료하지 않았습니다.' })
          return
        }
        await measurementService.stopMeasurement()
        await verifySaved()
      } catch {
        publish({ phase: 'error', message: '기록 종료에 실패했습니다. 저장된 원본은 유지됩니다.' })
      }
    })()
    return stopPromise
  }

  function onPosition(position: GeolocationPosition) {
    if (state.phase !== 'recording' || stopRequested) return
    if (!visible || position.timestamp < freshAfter) { detector.reset(); return }
    const measurement = measurementService.getMeasurementState()
    if (measurement.sessionId !== state.sessionId || measurement.ownerUserId !== ownerId) return
    const result = detector.observe(position, dependencies.now())
    if ('ignored' in result && result.ignored) return
    if (!result.valid) {
      publish({ gps: 'inaccurate' })
      return
    }
    lastReceivedAt = dependencies.now()
    publish({ currentPosition: { latitude: position.coords.latitude, longitude: position.coords.longitude },
      distanceM: result.distanceM, gps: 'receiving', message: null })
    if (result.arrived) {
      stopRequested = true
      // G2는 GPS 구독 통지 뒤 원본 저장 작업을 큐에 넣는다. 마지막 관측값도 저장 큐에 들어간 뒤 종료한다.
      queueMicrotask(() => { void finish('arrival') })
    }
  }

  return {
    updateMeasurement(next: Dependencies['measurement']) { measurementService = next },
    getState: () => state,
    subscribe(listener: (value: TransitAccessRecordingState) => void) {
      listeners.add(listener)
      listener(state)
      return () => { listeners.delete(listener) }
    },
    start(routeId: string, target: TransitBoardingTarget | null): Promise<void> {
      if (state.phase === 'starting' || state.phase === 'recording' || state.phase === 'stopping') return startPromise ?? Promise.resolve()
      const current = measurementService.getMeasurementState()
      if (current.status === 'starting' || current.status === 'recording') {
        publish({ message: '이미 다른 보행 기록이 실행 중입니다. 기존 기록을 종료한 뒤 안내를 시작해 주세요.' })
        return Promise.resolve()
      }
      run += 1
      stopRequested = false
      stopPromise = null
      lastReceivedAt = 0
      freshAfter = dependencies.now()
      const frozenTarget = target !== null && isValidTransitBoardingTarget(target)
        ? { ...target, coordinate: { ...target.coordinate } } : null
      detector = createTransitAccessArrivalDetector(frozenTarget?.coordinate ?? null, freshAfter)
      const guidanceId = dependencies.createId()
      publish({ phase: 'starting', guidanceId, routeId, target: frozenTarget, sessionId: null,
        currentPosition: null, distanceM: null, gps: 'waiting', stopReason: null,
        savedPointCount: 0, serverSync: 'pending', message: null })
      unsubscribeGps = measurementService.subscribeGps(onPosition, (error) => {
        detector.reset()
        publish({ gps: 'error', message: error.code === 1
          ? '위치 권한이 거부되었습니다. 자동 도착 감지를 중지합니다.'
          : 'GPS 수신이 중단되었습니다. 새 위치를 받을 때까지 도착 판정을 보류합니다.' })
      })
      startPromise = (async () => {
        try {
          const started = await measurementService.startMeasurement('navigation', {
            guidanceId, transitRouteId: routeId, walkingScope: 'first_boarding_access',
            targetSource: frozenTarget?.source ?? null, targetName: frozenTarget?.name ?? null,
          })
          if (!started) {
            unsubscribeGps?.(); unsubscribeGps = null
            publish({ phase: 'error', message: measurementService.getMeasurementState().message ?? '보행 기록을 시작하지 못했습니다.' })
            return
          }
          const next = measurementService.getMeasurementState()
          ownerId = next.ownerUserId
          publish({ phase: 'recording', sessionId: next.sessionId })
        } catch {
          unsubscribeGps?.(); unsubscribeGps = null
          publish({ phase: 'error', message: '보행 기록 시작에 실패했습니다.' })
        }
      })()
      // 시작 처리 중 종료/화면 이동이 발생해도 뒤늦게 GPS 기록을 남기지 않는다.
      void startPromise.then(() => { if (stopRequested) void finish('manual') })
      return startPromise
    },
    finish,
    verifySaved,
    setVisible(next: boolean) {
      visible = next
      detector.reset()
      freshAfter = dependencies.now()
      if (state.phase === 'recording') publish({ gps: next ? 'waiting' : 'hidden' })
    },
    tick() {
      if (state.phase === 'recording' && visible && dependencies.now() - (lastReceivedAt || freshAfter) > transitAccessArrivalPolicy.maximumFixAgeMs) {
        detector.reset()
        publish({ gps: 'stale' })
      }
    },
    dispose() {
      stopRequested = true
      unsubscribeGps?.(); unsubscribeGps = null
      listeners.clear()
      void finish('manual')
    },
  }
}
