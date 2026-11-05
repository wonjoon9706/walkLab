import type {
  MeasurementEvent,
  MeasurementEventType,
  RawGpsPoint,
} from '../../domain/measurement'
import type { AuthenticatedUser } from '../../services/auth/authService'
import type { GpsCollector } from '../../services/gps/gpsCollector'
import type { LocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'

export type MeasurementUiStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'completed'
  | 'interrupted'
  | 'error'

export type GpsUiStatus = 'idle' | 'waiting' | 'receiving' | 'error' | 'stopped'
export type LocalSaveStatus = 'idle' | 'saving' | 'saved' | 'failed'
export type MeasurementMode = 'manual' | 'navigation'

export interface MeasurementState {
  status: MeasurementUiStatus
  mode: MeasurementMode | null
  sessionId: string | null
  ownerUserId: string | null
  startedAt: string | null
  endedAt: string | null
  savedPointCount: number
  failedSaveCount: number
  firstSavedSequenceNo: number | null
  lastSavedSequenceNo: number | null
  nullOptionalFieldCount: number
  lastReceivedAt: string | null
  gpsStatus: GpsUiStatus
  localSaveStatus: LocalSaveStatus
  networkOnline: boolean
  message: string | null
}

export interface StartMeasurementInput {
  user: AuthenticatedUser | null
  confirmCurrentUser: () => Promise<AuthenticatedUser | null>
  mode?: MeasurementMode
  details?: MeasurementEvent['details']
}

export interface MeasurementManager {
  getState: () => MeasurementState
  subscribe: (listener: (state: MeasurementState) => void) => () => void
  start: (input: StartMeasurementInput) => Promise<boolean>
  stop: () => Promise<void>
  subscribeGps: (
    onPosition: PositionCallback,
    onError: PositionErrorCallback,
  ) => () => void
  recover: (ownerUserId: string) => Promise<void>
  updateNetworkStatus: (online: boolean) => void
  recordVisibility: (visible: boolean) => void
  dispose: () => void
}

export interface MeasurementManagerDependencies {
  repository: LocalMeasurementRepository
  createCollector: () => GpsCollector
  getOnline: () => boolean
  getSecureContext: () => boolean
  getSourcePlatform: () => string
  now: () => Date
  createId: () => string
  onPointSaved?: (ownerUserId: string) => void
  onMeasurementStopped?: () => void
}

const initialState: MeasurementState = {
  status: 'idle',
  mode: null,
  sessionId: null,
  ownerUserId: null,
  startedAt: null,
  endedAt: null,
  savedPointCount: 0,
  failedSaveCount: 0,
  firstSavedSequenceNo: null,
  lastSavedSequenceNo: null,
  nullOptionalFieldCount: 0,
  lastReceivedAt: null,
  gpsStatus: 'idle',
  localSaveStatus: 'idle',
  networkOnline: true,
  message: null,
}

function toIsoString(date: Date): string {
  return date.toISOString()
}

function getPositionErrorType(error: GeolocationPositionError): {
  eventType: MeasurementEventType
  errorCode: string
  message: string
} {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      eventType: 'permission_denied',
      errorCode: 'GEOLOCATION_PERMISSION_DENIED',
      message: '위치 권한이 거부되었습니다. Safari 설정에서 권한을 확인해 주세요.',
    }
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      eventType: 'position_unavailable',
      errorCode: 'GEOLOCATION_POSITION_UNAVAILABLE',
      message: '현재 위치를 확인할 수 없습니다. 수신 가능한 장소에서 다시 기다려 주세요.',
    }
  }

  return {
    eventType: 'position_timeout',
    errorCode: 'GEOLOCATION_TIMEOUT',
    message: '정해진 시간 안에 위치를 받지 못했습니다. GPS 수신을 계속 기다립니다.',
  }
}

function createPoint(
  position: GeolocationPosition,
  sessionId: string,
  sequenceNo: number,
  receivedAt: string,
  id: string,
): RawGpsPoint {
  return {
    id,
    sessionId,
    sequenceNo,
    measuredAt: new Date(position.timestamp).toISOString(),
    receivedAt,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    altitudeM: position.coords.altitude,
    altitudeAccuracyM: position.coords.altitudeAccuracy,
    deviceSpeedMps: position.coords.speed,
    headingDeg: position.coords.heading,
    schemaVersion: 1,
  }
}

export function createMeasurementManager(
  dependencies: MeasurementManagerDependencies,
): MeasurementManager {
  let state: MeasurementState = {
    ...initialState,
    networkOnline: dependencies.getOnline(),
  }
  let collector: GpsCollector | null = null
  let sequenceNo = 0
  let firstPointStored = false
  let stopInProgress = false
  let saveQueue: Promise<void> = Promise.resolve()
  const listeners = new Set<(nextState: MeasurementState) => void>()
  const gpsSubscribers = new Set<{
    onPosition: PositionCallback
    onError: PositionErrorCallback
  }>()

  function publish(partialState: Partial<MeasurementState>) {
    state = { ...state, ...partialState }
    listeners.forEach((listener) => listener(state))
  }

  function isActive(): boolean {
    return state.status === 'starting' || state.status === 'recording'
  }

  function requireActiveSession(): {
    sessionId: string
    ownerUserId: string
  } | null {
    if (state.sessionId === null || state.ownerUserId === null) {
      return null
    }

    return {
      sessionId: state.sessionId,
      ownerUserId: state.ownerUserId,
    }
  }

  function observeSave(task: () => Promise<void>) {
    publish({ localSaveStatus: 'saving' })
    const currentSave = saveQueue.then(task)

    saveQueue = currentSave
      .then(() => {
        publish({ localSaveStatus: 'saved' })
      })
      .catch(() => {
        // 한 콜백 저장 실패가 다음 콜백의 저장 시도를 막으면 안 된다.
        publish({
          localSaveStatus: 'failed',
          failedSaveCount: state.failedSaveCount + 1,
          message:
            '일부 GPS 데이터를 로컬에 저장하지 못했습니다. 다음 위치는 계속 저장합니다.',
        })
      })
  }

  function createEvent(
    sessionId: string,
    eventType: MeasurementEventType,
    occurredAt: string,
    errorCode: string | null = null,
  ): MeasurementEvent {
    return {
      id: dependencies.createId(),
      sessionId,
      eventType,
      occurredAt,
      receivedAt: toIsoString(dependencies.now()),
      errorCode,
      details: null,
      schemaVersion: 1,
    }
  }

  function handlePosition(position: GeolocationPosition) {
    const activeSession = requireActiveSession()

    if (activeSession === null || !isActive() || stopInProgress) {
      return
    }

    // 같은 원본 관측값을 저장과 실시간 안내가 공유하되, 안내 오류가 저장을 막지 않게 한다.
    gpsSubscribers.forEach((subscriber) => {
      try {
        subscriber.onPosition(position)
      } catch {
        // 구독 기능의 오류는 GPS 원본 저장 파이프라인과 분리한다.
      }
    })

    const receivedAt = toIsoString(dependencies.now())
    sequenceNo += 1
    const point = createPoint(
      position,
      activeSession.sessionId,
      sequenceNo,
      receivedAt,
      dependencies.createId(),
    )

    publish({
      status: 'recording',
      gpsStatus: 'receiving',
      lastReceivedAt: receivedAt,
      message: null,
    })

    observeSave(async () => {
      const startedEvent = firstPointStored
        ? undefined
        : createEvent(
            activeSession.sessionId,
            'measurement_started',
            point.measuredAt,
          )

      await dependencies.repository.savePoint(
        activeSession.ownerUserId,
        point,
        startedEvent,
      )
      firstPointStored = true
      const nullOptionalFieldCount = [
        point.altitudeM,
        point.altitudeAccuracyM,
        point.deviceSpeedMps,
        point.headingDeg,
      ].filter((value) => value === null).length
      publish({
        savedPointCount: state.savedPointCount + 1,
        firstSavedSequenceNo: state.firstSavedSequenceNo ?? point.sequenceNo,
        lastSavedSequenceNo: point.sequenceNo,
        nullOptionalFieldCount:
          state.nullOptionalFieldCount + nullOptionalFieldCount,
      })
      dependencies.onPointSaved?.(activeSession.ownerUserId)
    })
  }

  function handlePositionError(error: GeolocationPositionError) {
    const activeSession = requireActiveSession()

    if (activeSession === null || !isActive() || stopInProgress) {
      return
    }

    gpsSubscribers.forEach((subscriber) => {
      try {
        subscriber.onError(error)
      } catch {
        // 구독 기능의 오류가 측정 오류 이벤트 저장을 막지 않게 한다.
      }
    })

    const errorInfo = getPositionErrorType(error)
    const occurredAt = toIsoString(dependencies.now())

    publish({
      gpsStatus: 'error',
      message: errorInfo.message,
    })

    observeSave(() =>
      dependencies.repository.saveEvent({
        id: dependencies.createId(),
        sessionId: activeSession.sessionId,
        ownerUserId: activeSession.ownerUserId,
        eventType: errorInfo.eventType,
        occurredAt,
        receivedAt: occurredAt,
        errorCode: errorInfo.errorCode,
      }),
    )

    if (error.code === error.PERMISSION_DENIED) {
      collector?.stop()
      observeSave(() =>
        dependencies.repository.setSessionStatus(
          activeSession.ownerUserId,
          activeSession.sessionId,
          'error',
        ),
      )
      publish({ status: 'error', mode: null })
    }
  }

  return {
    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },

    subscribeGps(onPosition, onError) {
      const subscriber = { onPosition, onError }
      gpsSubscribers.add(subscriber)
      return () => gpsSubscribers.delete(subscriber)
    },

    async start(input) {
      if (isActive()) {
        publish({ message: '이미 측정 중입니다.' })
        return false
      }

      if (!dependencies.getOnline()) {
        publish({
          networkOnline: false,
          message: '새 측정을 시작하려면 인터넷 연결이 필요합니다.',
        })
        return false
      }

      if (!dependencies.getSecureContext()) {
        publish({ message: 'GPS 측정은 HTTPS 보안 연결에서만 사용할 수 있습니다.' })
        return false
      }

      if (input.user === null) {
        publish({ message: '로그인 상태를 다시 확인해 주세요.' })
        return false
      }

      let confirmedUser: AuthenticatedUser | null

      try {
        confirmedUser = await input.confirmCurrentUser()
      } catch {
        publish({ message: '로그인 확인 중 네트워크 오류가 발생했습니다.' })
        return false
      }

      if (confirmedUser === null || confirmedUser.id !== input.user.id) {
        publish({ message: '로그인 확인에 실패했습니다. 다시 로그인해 주세요.' })
        return false
      }

      const sessionId = dependencies.createId()
      const startedAt = toIsoString(dependencies.now())
      const mode = input.mode ?? 'manual'
      let nextCollector: GpsCollector

      try {
        // collector 생성은 권한을 요청하지 않으며 API 지원 여부만 확인한다.
        nextCollector = dependencies.createCollector()
      } catch {
        publish({ message: '이 브라우저에서는 위치 측정 기능을 사용할 수 없습니다.' })
        return false
      }

      publish({
        status: 'starting',
        mode,
        sessionId,
        ownerUserId: confirmedUser.id,
        startedAt,
        endedAt: null,
        savedPointCount: 0,
        failedSaveCount: 0,
        firstSavedSequenceNo: null,
        lastSavedSequenceNo: null,
        nullOptionalFieldCount: 0,
        lastReceivedAt: null,
        gpsStatus: 'waiting',
        localSaveStatus: 'saving',
        networkOnline: true,
        message: '위치 권한과 첫 GPS 신호를 기다리고 있습니다.',
      })

      try {
        await dependencies.repository.createSession({
          id: sessionId,
          ownerUserId: confirmedUser.id,
          startedAt,
          sourcePlatform: dependencies.getSourcePlatform(),
          eventId: dependencies.createId(),
          startEventDetails: input.details,
        })

        sequenceNo = 0
        firstPointStored = false
        saveQueue = Promise.resolve()
        collector = nextCollector
        collector.start(handlePosition, handlePositionError)
        await dependencies.repository.setSessionStatus(
          confirmedUser.id,
          sessionId,
          'recording',
        )
        publish({ status: 'recording', localSaveStatus: 'saved' })
        return true
      } catch {
        collector?.stop()
        collector = null
        publish({
          status: 'error',
          mode: null,
          gpsStatus: 'error',
          localSaveStatus: 'failed',
          message: '측정을 시작하지 못했습니다. 로컬 저장소와 위치 권한을 확인해 주세요.',
        })
        return false
      }
    },

    async stop() {
      const activeSession = requireActiveSession()

      if (activeSession === null || !isActive() || stopInProgress) {
        return
      }

      stopInProgress = true
      collector?.stop()
      collector = null
      try {
        await saveQueue

        const endedAt = toIsoString(dependencies.now())
        let stoppedEventSaved = true

        try {
          await dependencies.repository.saveEvent({
            id: dependencies.createId(),
            sessionId: activeSession.sessionId,
            ownerUserId: activeSession.ownerUserId,
            eventType: 'measurement_stopped',
            occurredAt: endedAt,
            receivedAt: endedAt,
          })
        } catch {
          stoppedEventSaved = false
        }

        try {
          await dependencies.repository.setSessionStatus(
            activeSession.ownerUserId,
            activeSession.sessionId,
            'completed',
            endedAt,
          )
          publish({
            status: 'completed',
            mode: null,
            endedAt,
            gpsStatus: 'stopped',
            localSaveStatus: stoppedEventSaved ? 'saved' : 'failed',
            message: stoppedEventSaved
              ? '측정이 종료되고 로컬에 저장되었습니다.'
              : '측정은 종료됐지만 종료 이벤트 저장에 실패했습니다.',
          })
          dependencies.onMeasurementStopped?.()
        } catch {
          publish({
            status: 'error',
            mode: null,
            gpsStatus: 'stopped',
            localSaveStatus: 'failed',
            message: 'GPS는 중지했지만 측정 종료 상태를 저장하지 못했습니다.',
          })
        }
      } finally {
        stopInProgress = false
      }
    },

    async recover(ownerUserId) {
      if (isActive()) {
        return
      }

      const recoveredCount = await dependencies.repository.recoverInterruptedSessions(
        ownerUserId,
      )

      if (recoveredCount > 0) {
        publish({
          status: 'interrupted',
          mode: null,
          gpsStatus: 'stopped',
          message: `이전에 끝나지 않은 측정 ${recoveredCount}건을 중단 상태로 복구했습니다. GPS는 자동 재시작하지 않았습니다.`,
        })
      }
    },

    updateNetworkStatus(online) {
      publish({ networkOnline: online })
    },

    recordVisibility(visible) {
      const activeSession = requireActiveSession()

      if (activeSession === null || !isActive()) {
        return
      }

      const now = toIsoString(dependencies.now())
      observeSave(() =>
        dependencies.repository.saveEvent({
          id: dependencies.createId(),
          sessionId: activeSession.sessionId,
          ownerUserId: activeSession.ownerUserId,
          eventType: visible ? 'page_visible' : 'page_hidden',
          occurredAt: now,
          receivedAt: now,
        }),
      )
    },

    dispose() {
      collector?.stop()
      collector = null
      gpsSubscribers.clear()

      if (stopInProgress) {
        return
      }

      const activeSession = requireActiveSession()
      if (activeSession === null || !isActive()) {
        return
      }

      const now = toIsoString(dependencies.now())
      void saveQueue.finally(async () => {
        try {
          await dependencies.repository.saveEvent({
            id: dependencies.createId(),
            sessionId: activeSession.sessionId,
            ownerUserId: activeSession.ownerUserId,
            eventType: 'measurement_interrupted',
            occurredAt: now,
            receivedAt: now,
          })
          await dependencies.repository.setSessionStatus(
            activeSession.ownerUserId,
            activeSession.sessionId,
            'interrupted',
          )
        } catch {
          // 다음 앱 시작의 recovery가 남은 recording 세션을 다시 처리한다.
        }
      })
    },
  }
}
