import { describe, expect, it, vi } from 'vitest'
import type { WalkingRoute, WalkingSpeedProfile } from '../../domain/walkingRoute'
import type { GpsCollector } from '../gps/gpsCollector'
import {
  createLiveNavigationManager,
  type LiveNavigationManagerDependencies,
} from './liveNavigationManager'

const route: WalkingRoute = {
  distanceM: 222,
  providerDurationSeconds: 180,
  coordinates: [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.001 },
    { latitude: 0, longitude: 0.002 },
  ],
  provider: 'kakao-walking-route',
  requestedAt: '2026-10-30T00:00:00.000Z',
}

const baselineSpeed: WalkingSpeedProfile = {
  speedMps: 1.4,
  source: 'personalized',
  modelVersion: 'recency-weighted-v1',
  validSessionCount: 5,
}

function createPosition(
  latitude: number,
  longitude: number,
  timestamp: number,
  accuracy = 5,
  speed: number | null = 1,
): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed,
      toJSON: () => ({}),
    },
    toJSON: () => ({}),
  }
}

function setup(requestRoute = vi.fn().mockResolvedValue(route)) {
  let onPosition: PositionCallback | null = null
  let onError: PositionErrorCallback | null = null
  let nowMs = 0
  let intervalCallback: (() => void) | null = null
  const collector: GpsCollector = {
    start: vi.fn((nextPosition, nextError) => {
      onPosition = nextPosition
      onError = nextError
    }),
    stop: vi.fn(),
    isRunning: () => onPosition !== null,
  }
  const dependencies: LiveNavigationManagerDependencies = {
    createCollector: () => collector,
    requestRoute,
    getSecureContext: () => true,
    now: () => new Date(nowMs),
    setInterval: vi.fn((callback) => {
      intervalCallback = callback
      return 7
    }),
    clearInterval: vi.fn(),
  }
  const manager = createLiveNavigationManager(dependencies)
  const start = (forceInitialReroute = false) =>
    manager.start({
      route,
      destination: route.coordinates.at(-1)!,
      baselineSpeed,
      forceInitialReroute,
    })

  return {
    manager,
    collector,
    dependencies,
    requestRoute,
    start,
    position(position: GeolocationPosition) {
      onPosition?.(position)
    },
    error(error: GeolocationPositionError) {
      onError?.(error)
    },
    setNow(value: number) {
      nowMs = value
    },
    runStaleCheck() {
      intervalCallback?.()
    },
  }
}

describe('실시간 안내 관리자', () => {
  it('안내 시작과 종료 시 GPS 감시와 타이머를 정리한다', () => {
    const test = setup()
    test.start()

    expect(test.collector.start).toHaveBeenCalledOnce()
    expect(test.manager.getState().isActive).toBe(true)

    test.manager.stop()

    expect(test.collector.stop).toHaveBeenCalledOnce()
    expect(test.dependencies.clearInterval).toHaveBeenCalledWith(7)
    expect(test.manager.getState().isActive).toBe(false)
  })

  it('정확도가 낮은 GPS는 진행도 계산에서 제외한다', () => {
    const test = setup()
    test.start()
    test.position(createPosition(0, 0.0005, 0, 80))

    expect(test.manager.getState()).toMatchObject({
      status: 'gps_unstable',
      remainingDistanceM: 222,
      recentSpeedMps: null,
    })
  })

  it('장시간 유효 위치가 없으면 GPS 갱신 중단으로 표시한다', () => {
    const test = setup()
    test.start()
    test.setNow(21_000)
    test.runStaleCheck()

    expect(test.manager.getState().status).toBe('stale')
  })

  it('충분한 최근 이동 관측이 쌓이면 혼합속도로 ETA를 갱신한다', () => {
    const test = setup()
    test.start()
    const longitudes = [0, 0.00002, 0.00004, 0.00006]
    longitudes.forEach((longitude, index) => {
      const timestamp = index * 2_000
      test.setNow(timestamp)
      test.position(createPosition(0, longitude, timestamp, 5, 1))
    })

    expect(test.manager.getState()).toMatchObject({
      status: 'moving',
      recentSpeedMps: 1,
      speedSource: 'recent_blended',
    })
    expect(test.manager.getState().appliedSpeedMps).toBeCloseTo(1.16)
    expect(test.manager.getState().remainingDurationSeconds).toBeGreaterThan(0)
    expect(test.manager.getState().arrivalAt).not.toBeNull()
  })

  it('급격한 진행도 점프는 남은 거리 계산에 반영하지 않는다', () => {
    const test = setup()
    test.start()
    test.position(createPosition(0, 0, 0))
    const initialRemaining = test.manager.getState().remainingDistanceM

    test.setNow(1_000)
    test.position(createPosition(0, 0.0018, 1_000))

    expect(test.manager.getState().status).toBe('gps_unstable')
    expect(test.manager.getState().remainingDistanceM).toBe(initialRemaining)
    expect(test.manager.getState().message).toMatch(/갑자기 변해/)
  })

  it('정지 중에는 학습속도를 사용하되 현재 시각 기준 도착시각을 늦춘다', () => {
    const test = setup()
    test.start()
    for (let index = 0; index < 4; index += 1) {
      const timestamp = index * 2_000
      test.setNow(timestamp)
      test.position(createPosition(0, 0, timestamp, 5, 0))
    }
    const firstArrival = Date.parse(test.manager.getState().arrivalAt!)

    test.setNow(8_000)
    test.position(createPosition(0, 0, 8_000, 5, 0))
    const nextArrival = Date.parse(test.manager.getState().arrivalAt!)

    expect(test.manager.getState()).toMatchObject({
      status: 'stationary',
      recentSpeedMps: 0,
      appliedSpeedMps: baselineSpeed.speedMps,
      speedSource: 'personalized',
    })
    expect(nextArrival).toBeGreaterThan(firstArrival)
  })

  it('검색 출발지 안내는 첫 실제 위치에서 경로를 다시 조회한다', async () => {
    const test = setup()
    test.start(true)
    test.position(createPosition(0, 0.0002, 0))
    await vi.waitFor(() => expect(test.requestRoute).toHaveBeenCalledOnce())

    expect(test.requestRoute).toHaveBeenCalledWith(
      { latitude: 0, longitude: 0.0002 },
      route.coordinates.at(-1),
    )
  })

  it('여러 유효 위치가 계속 경로를 벗어날 때 한 번만 재탐색한다', async () => {
    const requestRoute = vi.fn().mockRejectedValue(new Error('network'))
    const test = setup(requestRoute)
    test.start()

    test.position(createPosition(0.001, 0.0001, 0))
    test.setNow(1_000)
    test.position(createPosition(0.001, 0.00011, 1_000))
    test.setNow(2_000)
    test.position(createPosition(0.001, 0.00012, 2_000))
    await vi.waitFor(() => expect(requestRoute).toHaveBeenCalledOnce())
    expect(test.manager.getState().message).toMatch(/기존 경로/)

    test.setNow(3_000)
    test.position(createPosition(0.001, 0.00013, 3_000))
    expect(requestRoute).toHaveBeenCalledOnce()
    expect(test.manager.getState().status).toBe('off_route')
    expect(test.manager.getState().message).toMatch(/재탐색/)
  })

  it('위치 권한 거부 시 GPS 감시를 종료한다', () => {
    const test = setup()
    test.start()
    test.error({
      code: 1,
      message: 'denied',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    })

    expect(test.collector.stop).toHaveBeenCalledOnce()
    expect(test.manager.getState()).toMatchObject({
      status: 'error',
      isActive: false,
    })
  })
})
