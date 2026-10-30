import type {
  LiveNavigationObservation,
  LiveNavigationState,
  RouteProgress,
  StartLiveNavigationInput,
} from '../../domain/liveNavigation'
import type { GeoCoordinate, WalkingRoute } from '../../domain/walkingRoute'
import type { GpsCollector } from '../gps/gpsCollector'
import {
  calculateRouteProgress,
  combineWalkingSpeed,
  estimateRecentWalkingSpeed,
} from './liveNavigationAnalysis'
import {
  liveNavigationConfig,
  type LiveNavigationConfig,
} from './liveNavigationConfig'

export interface LiveNavigationManager {
  getState: () => LiveNavigationState
  subscribe: (listener: (state: LiveNavigationState) => void) => () => void
  start: (input: StartLiveNavigationInput) => void
  stop: () => void
  dispose: () => void
}

export interface LiveNavigationManagerDependencies {
  createCollector: () => GpsCollector
  requestRoute: (
    start: GeoCoordinate,
    destination: GeoCoordinate,
  ) => Promise<WalkingRoute>
  getSecureContext: () => boolean
  now: () => Date
  setInterval: (callback: () => void, milliseconds: number) => number
  clearInterval: (intervalId: number) => void
}

const initialState: LiveNavigationState = {
  status: 'idle',
  isActive: false,
  route: null,
  currentPosition: null,
  currentAccuracyM: null,
  remainingCoordinates: [],
  remainingDistanceM: null,
  progressRatio: null,
  recentSpeedMps: null,
  appliedSpeedMps: null,
  speedSource: null,
  remainingDurationSeconds: null,
  arrivalAt: null,
  lastPositionAt: null,
  rerouteCount: 0,
  message: null,
}

function isValidCoordinate(coordinate: GeoCoordinate): boolean {
  return (
    Number.isFinite(coordinate.latitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
  )
}

function getGpsErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return '위치 권한이 거부되어 안내를 시작할 수 없습니다.'
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return '현재 위치를 받을 수 없습니다. GPS 수신 상태를 확인해 주세요.'
  }
  return '정해진 시간 안에 위치를 받지 못했습니다. GPS 신호를 계속 기다립니다.'
}

export function createLiveNavigationManager(
  dependencies: LiveNavigationManagerDependencies,
  config: LiveNavigationConfig = liveNavigationConfig,
): LiveNavigationManager {
  let state: LiveNavigationState = { ...initialState }
  let collector: GpsCollector | null = null
  let staleIntervalId: number | null = null
  let input: StartLiveNavigationInput | null = null
  let progress: RouteProgress | null = null
  let observations: LiveNavigationObservation[] = []
  let startedAtMs = 0
  let lastValidPositionAtMs: number | null = null
  let offRouteObservationCount = 0
  let lastRerouteAtMs: number | null = null
  let rerouteInProgress = false
  let initialRerouteAttempted = false
  const listeners = new Set<(nextState: LiveNavigationState) => void>()

  function publish(partial: Partial<LiveNavigationState>) {
    state = { ...state, ...partial }
    listeners.forEach((listener) => listener(state))
  }

  function stopResources() {
    collector?.stop()
    collector = null
    if (staleIntervalId !== null) {
      dependencies.clearInterval(staleIntervalId)
      staleIntervalId = null
    }
  }

  async function rerouteFrom(position: GeoCoordinate) {
    if (input === null || rerouteInProgress) return

    const nowMs = dependencies.now().getTime()
    const cooldownPassed =
      lastRerouteAtMs === null ||
      nowMs - lastRerouteAtMs >= config.rerouteCooldownSeconds * 1000
    if (
      !cooldownPassed ||
      state.rerouteCount >= config.maximumRerouteCount
    ) {
      publish({
        status: 'off_route',
        message:
          state.rerouteCount >= config.maximumRerouteCount
            ? '자동 재탐색 횟수를 모두 사용했습니다. 안내를 종료한 뒤 경로를 다시 선택해 주세요.'
            : '경로를 벗어났습니다. 연속 요청 방지를 위해 재탐색을 잠시 기다립니다.',
      })
      return
    }

    rerouteInProgress = true
    lastRerouteAtMs = nowMs
    const nextRerouteCount = state.rerouteCount + 1
    publish({
      status: 'rerouting',
      rerouteCount: nextRerouteCount,
      message: '현재 위치에서 목적지까지 새 경로를 찾는 중입니다.',
    })

    try {
      const nextRoute = await dependencies.requestRoute(
        position,
        input.destination,
      )
      if (!state.isActive || input === null) return
      input = { ...input, route: nextRoute, forceInitialReroute: false }
      progress = null
      offRouteObservationCount = 0
      const nextProgress = calculateRouteProgress(
        nextRoute.coordinates,
        position,
        null,
        config,
      )
      progress = nextProgress
      publish({
        route: nextRoute,
        status: 'gps_unstable',
        remainingCoordinates:
          nextProgress?.remainingCoordinates ?? nextRoute.coordinates,
        remainingDistanceM:
          nextProgress?.remainingDistanceM ?? nextRoute.distanceM,
        progressRatio:
          nextProgress === null
            ? null
            : nextProgress.traveledDistanceM /
              (nextProgress.traveledDistanceM +
                nextProgress.remainingDistanceM),
        message: '현재 위치 기준 새 경로를 적용했습니다. 속도를 확인하는 중입니다.',
      })
    } catch {
      if (state.isActive) {
        publish({
          status: 'off_route',
          message: '경로 재탐색에 실패했습니다. 기존 경로를 유지합니다.',
        })
      }
    } finally {
      rerouteInProgress = false
    }
  }

  function handlePosition(position: GeolocationPosition) {
    if (!state.isActive || input === null) return

    const now = dependencies.now()
    const coordinate = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    }
    const measuredAtMs = position.timestamp
    const accuracyM = position.coords.accuracy
    publish({
      currentPosition: isValidCoordinate(coordinate) ? coordinate : null,
      currentAccuracyM: Number.isFinite(accuracyM) ? accuracyM : null,
      lastPositionAt: now.toISOString(),
    })

    const positionAgeSeconds = (now.getTime() - measuredAtMs) / 1000
    const qualityIsValid =
      isValidCoordinate(coordinate) &&
      Number.isFinite(accuracyM) &&
      accuracyM >= 0 &&
      accuracyM <= config.maximumAccuracyM &&
      Number.isFinite(measuredAtMs) &&
      positionAgeSeconds >= -5 &&
      positionAgeSeconds <= config.maximumPositionAgeSeconds
    if (!qualityIsValid) {
      publish({
        status: 'gps_unstable',
        message: 'GPS 정확도가 낮아 이번 위치는 진행도와 속도 계산에서 제외했습니다.',
      })
      return
    }

    lastValidPositionAtMs = now.getTime()
    if (input.forceInitialReroute && !initialRerouteAttempted) {
      initialRerouteAttempted = true
      void rerouteFrom(coordinate)
      return
    }
    if (rerouteInProgress) {
      return
    }

    const nextProgress = calculateRouteProgress(
      input.route.coordinates,
      coordinate,
      progress,
      config,
    )
    if (nextProgress === null) {
      publish({ status: 'error', message: '경로 진행도를 계산할 수 없습니다.' })
      return
    }

    if (progress !== null && observations.length > 0) {
      const elapsedSeconds = Math.max(
        0,
        (measuredAtMs - observations.at(-1)!.measuredAtMs) / 1000,
      )
      const maximumAdvanceM = Math.max(
        25,
        elapsedSeconds * config.maximumWalkingSpeedMps + accuracyM,
      )
      if (
        nextProgress.traveledDistanceM - progress.traveledDistanceM >
        maximumAdvanceM
      ) {
        publish({
          status: 'gps_unstable',
          message: '경로 진행도가 갑자기 변해 이번 위치는 계산에서 제외했습니다.',
        })
        return
      }
    }

    progress = nextProgress
    if (nextProgress.distanceFromRouteM > config.offRouteDistanceM) {
      offRouteObservationCount += 1
    } else {
      offRouteObservationCount = 0
    }

    observations.push({
      coordinate,
      accuracyM,
      measuredAtMs,
      deviceSpeedMps:
        position.coords.speed !== null &&
        Number.isFinite(position.coords.speed)
          ? position.coords.speed
          : null,
    })
    const observationCutoff =
      measuredAtMs - config.recentSpeedWindowSeconds * 2 * 1000
    observations = observations.filter(
      (observation) => observation.measuredAtMs >= observationCutoff,
    )

    const recentSpeed = estimateRecentWalkingSpeed(observations, config)
    const combinedSpeed = combineWalkingSpeed(
      recentSpeed,
      input.baselineSpeed.speedMps,
      config,
    )
    const remainingDurationSeconds =
      nextProgress.remainingDistanceM / combinedSpeed.speedMps
    const routeDistanceM =
      nextProgress.traveledDistanceM + nextProgress.remainingDistanceM
    const progressRatio =
      routeDistanceM > 0
        ? Math.max(
            0,
            Math.min(1, 1 - nextProgress.remainingDistanceM / routeDistanceM),
          )
        : null
    const status =
      recentSpeed.state === 'moving'
        ? 'moving'
        : recentSpeed.state === 'stationary'
          ? 'stationary'
          : 'gps_unstable'
    const message =
      recentSpeed.state === 'stationary'
        ? '정지 상태입니다. 학습속도로 남은 시간을 계산하며 도착시각은 계속 늦춰집니다.'
        : recentSpeed.state === 'uncertain'
          ? '최근 속도가 아직 충분하지 않아 학습속도로 계산합니다.'
          : null

    publish({
      status,
      remainingCoordinates: nextProgress.remainingCoordinates,
      remainingDistanceM: nextProgress.remainingDistanceM,
      progressRatio,
      recentSpeedMps: recentSpeed.speedMps,
      appliedSpeedMps: combinedSpeed.speedMps,
      speedSource: combinedSpeed.usesRecentSpeed
        ? 'recent_blended'
        : input.baselineSpeed.source,
      remainingDurationSeconds,
      arrivalAt: new Date(
        now.getTime() + remainingDurationSeconds * 1000,
      ).toISOString(),
      message,
    })

    if (
      offRouteObservationCount >= config.offRouteObservationCount &&
      !rerouteInProgress
    ) {
      publish({
        status: 'off_route',
        message: '여러 위치에서 경로 이탈이 확인되어 새 경로를 찾습니다.',
      })
      void rerouteFrom(coordinate)
    }
  }

  function handlePositionError(error: GeolocationPositionError) {
    if (!state.isActive) return
    const permissionDenied = error.code === error.PERMISSION_DENIED
    if (permissionDenied) {
      stopResources()
    }
    publish({
      status: permissionDenied ? 'error' : 'gps_unstable',
      isActive: permissionDenied ? false : state.isActive,
      message: getGpsErrorMessage(error),
    })
  }

  function checkStalePosition() {
    if (!state.isActive) return
    const referenceTime = lastValidPositionAtMs ?? startedAtMs
    const elapsedSeconds =
      (dependencies.now().getTime() - referenceTime) / 1000
    if (elapsedSeconds >= config.staleAfterSeconds) {
      publish({
        status: 'stale',
        message: '최근 GPS 위치가 갱신되지 않았습니다. 화면을 켠 채 GPS 신호를 확인해 주세요.',
      })
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    start(nextInput) {
      if (state.isActive) return
      if (!dependencies.getSecureContext()) {
        publish({
          status: 'error',
          message: '실시간 안내는 HTTPS 보안 연결에서만 사용할 수 있습니다.',
        })
        return
      }

      try {
        collector = dependencies.createCollector()
      } catch {
        publish({
          status: 'error',
          message: '이 브라우저에서는 실시간 위치 안내를 사용할 수 없습니다.',
        })
        return
      }

      input = nextInput
      progress = null
      observations = []
      startedAtMs = dependencies.now().getTime()
      lastValidPositionAtMs = null
      offRouteObservationCount = 0
      lastRerouteAtMs = null
      rerouteInProgress = false
      initialRerouteAttempted = false
      state = {
        ...initialState,
        status: 'starting',
        isActive: true,
        route: nextInput.route,
        remainingCoordinates: nextInput.route.coordinates,
        remainingDistanceM: nextInput.route.distanceM,
        appliedSpeedMps: nextInput.baselineSpeed.speedMps,
        speedSource: nextInput.baselineSpeed.source,
        message: '첫 GPS 위치를 기다리고 있습니다.',
      }
      listeners.forEach((listener) => listener(state))

      try {
        collector.start(handlePosition, handlePositionError)
        staleIntervalId = dependencies.setInterval(checkStalePosition, 5_000)
      } catch {
        stopResources()
        publish({
          status: 'error',
          isActive: false,
          message: 'GPS 감시를 시작하지 못했습니다. 위치 권한을 확인해 주세요.',
        })
      }
    },
    stop() {
      stopResources()
      publish({
        status: 'idle',
        isActive: false,
        route: null,
        message: '실시간 안내를 종료했습니다.',
      })
      input = null
      progress = null
      observations = []
    },
    dispose() {
      stopResources()
      input = null
      progress = null
      observations = []
      listeners.clear()
    },
  }
}
