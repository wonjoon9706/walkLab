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
    runDisplayUpdate() {
      intervalCallback?.()
    },
  }
}

describe('실시간 안내 관리자', () => {
  it('비정상 미래 시각이나 변환 불가 timestamp가 이후 정상 GPS를 막지 않는다', () => {
    const test = setup()
    test.start()
    test.position(createPosition(0, 0, 0))
    test.position(createPosition(0, 0.00001, 86_400_000))
    expect(() => test.position(createPosition(0, 0.00001, 1e99))).not.toThrow()
    test.setNow(2_000)
    test.position(createPosition(0, 0.00002, 2_000))
    expect(test.manager.getState().lastPositionAt).toBe(new Date(2_000).toISOString())
    expect(test.manager.getState().currentPosition?.longitude).toBe(0.00002)
  })
  it('동일 경로·위치에서도 안정된 현재 속도가 빠르면 남은 ETA가 짧아진다', () => {
    const slow = setup()
    const fast = setup()
    slow.start(); fast.start()
    for (let i = 0; i < 10; i += 1) {
      const timestamp = i * 2_000
      for (const [test, speed] of [[slow, 0.8], [fast, 2]] as const) {
        test.setNow(timestamp)
        test.position(createPosition(0, i * 0.00002, timestamp, 5, speed))
      }
    }
    expect(slow.manager.getState().remainingDistanceM).toBe(fast.manager.getState().remainingDistanceM)
    expect(slow.manager.getState().remainingDurationSeconds!).toBeGreaterThan(fast.manager.getState().remainingDurationSeconds!)
    expect(slow.manager.getState().pace).toBe('slower')
    expect(fast.manager.getState().pace).toBe('faster')
  })
  it('같은 GPS 응답은 속도 관측과 수신 신선도를 갱신하지 않는다', () => {
    const test = setup()
    test.start()
    const fix = createPosition(0, 0.0001, 0)
    test.position(fix)
    for (let i = 1; i <= 12; i += 1) {
      test.setNow(i * 2_000)
      test.position(fix)
      test.runStaleCheck()
    }
    expect(test.manager.getState()).toMatchObject({ status: 'stale', recentSpeedMps: null, pace: 'checking' })
  })

  it('장치 속도가 정상이더라도 좌표 도약이면 현재 속도 표시를 보류한다', () => {
    const test = setup()
    test.start()
    test.position(createPosition(0, 0, 0, 5, 1.4))
    test.setNow(1_000)
    test.position(createPosition(0.01, 0, 1_000, 5, 1.4))
    expect(test.manager.getState()).toMatchObject({ status: 'gps_unstable', recentSpeedMps: null, pace: 'checking' })
    expect(test.manager.getState().remainingDistanceM).toBeCloseTo(222.39, 0)
  })

  it('참고 경로 이탈은 직선 ETA나 추가 API 요청으로 처리하지 않는다', () => {
    const test = setup()
    test.manager.start({ route, destination: route.coordinates.at(-1)!, baselineSpeed,
      forceInitialReroute: false, allowReroute: false, isReferenceRoute: true })
    for (let i = 0; i < 4; i += 1) {
      test.setNow(i * 2_000)
      test.position(createPosition(0.001, i * 0.00001, i * 2_000))
    }
    expect(test.manager.getState()).toMatchObject({ status: 'off_route', remainingDurationSeconds: null,
      remainingDistanceM: null, arrivalAt: null, isReferenceRoute: true })
    expect(test.requestRoute).not.toHaveBeenCalled()
  })

  it('화면 복귀 후 숨겨진 동안의 GPS나 과거 관측을 현재 속도로 재사용하지 않는다', () => {
    const test = setup()
    test.start()
    for (let i = 0; i < 10; i += 1) {
      test.setNow(i * 2_000)
      test.position(createPosition(0, i * 0.00002, i * 2_000))
    }
    expect(test.manager.getState().pace).toBe('slower')
    test.manager.setVisible(false)
    test.setNow(40_000)
    test.position(createPosition(0, 0.0004, 40_000))
    test.manager.setVisible(true)
    test.position(createPosition(0, 0.0003, 30_000))
    expect(test.manager.getState()).toMatchObject({ status: 'starting', recentSpeedMps: null, pace: 'checking' })
    test.setNow(42_000)
    test.position(createPosition(0, 0.00042, 42_000))
    expect(test.manager.getState().recentSpeedMps).toBeNull()
  })

  it('최근 혼합속도 적용 뒤 정지하면 평소 속도로 복귀하고 느림으로 표시하지 않는다', () => {
    const test = setup()
    test.start()
    for (let i = 0; i < 10; i += 1) {
      test.setNow(i * 2_000)
      test.position(createPosition(0, i * 0.00002, i * 2_000, 5, 1))
    }
    expect(test.manager.getState().speedSource).toBe('recent_blended')
    for (let i = 10; i <= 17; i += 1) {
      test.setNow(i * 2_000)
      test.position(createPosition(0, 0.00018, i * 2_000, 5, 0))
    }
    expect(test.manager.getState()).toMatchObject({ status: 'stationary', pace: 'checking',
      appliedSpeedMps: baselineSpeed.speedMps, speedSource: 'personalized' })
  })

  it('중단된 안내의 늦은 재탐색 응답은 새 안내 경로를 덮어쓰지 않는다', async () => {
    let resolve!: (route: WalkingRoute) => void
    const test = setup(vi.fn(() => new Promise<WalkingRoute>((done) => { resolve = done })))
    test.start(true)
    test.position(createPosition(0, 0, 0))
    test.manager.stop()
    const newRoute = { ...route, distanceM: 500 }
    test.manager.start({ route: newRoute, destination: route.coordinates.at(-1)!, baselineSpeed, forceInitialReroute: false })
    resolve(route)
    await Promise.resolve()
    expect(test.manager.getState().route?.distanceM).toBe(500)
  })
  it('안내 시작과 종료 시 GPS 감시와 타이머를 정리한다', () => {
    const test = setup()
    test.start()

    expect(test.collector.start).toHaveBeenCalledOnce()
    expect(test.manager.getState().isActive).toBe(true)
    expect(test.dependencies.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      1_000,
    )

    test.manager.stop()

    expect(test.collector.stop).toHaveBeenCalledOnce()
    expect(test.dependencies.clearInterval).toHaveBeenCalledWith(7)
    expect(test.manager.getState().isActive).toBe(false)
  })

  it('외부 측정 GPS를 사용하면 별도 collector를 시작하지 않는다', () => {
    const test = setup()
    const unsubscribe = vi.fn()
    const subscribe = vi.fn().mockReturnValue(unsubscribe)

    const started = test.manager.start(
      {
        route,
        destination: route.coordinates.at(-1)!,
        baselineSpeed,
        forceInitialReroute: false,
      },
      { subscribe },
    )

    expect(started).toBe(true)
    expect(subscribe).toHaveBeenCalledOnce()
    expect(test.collector.start).not.toHaveBeenCalled()

    test.manager.stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
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
    const longitudes = Array.from(
      { length: 10 },
      (_value, index) => index * 0.00002,
    )
    longitudes.slice(0, -1).forEach((longitude, index) => {
      const timestamp = index * 2_000
      test.setNow(timestamp)
      test.position(createPosition(0, longitude, timestamp, 5, 1))
    })
    const beforeRecentSpeedAdoption =
      test.manager.getState().remainingDurationSeconds!
    expect(test.manager.getState()).toMatchObject({
      status: 'moving',
      appliedSpeedMps: baselineSpeed.speedMps,
      speedSource: 'personalized',
    })
    test.setNow(18_000)
    test.position(createPosition(0, longitudes.at(-1)!, 18_000, 5, 1))

    expect(test.manager.getState()).toMatchObject({
      status: 'moving',
      recentSpeedMps: 1,
      speedSource: 'recent_blended',
    })
    expect(test.manager.getState().appliedSpeedMps).toBeCloseTo(1.16)
    expect(test.manager.getState().remainingDurationSeconds).toBeGreaterThan(0)
    expect(test.manager.getState().arrivalAt).not.toBeNull()
    const rawDurationSeconds =
      test.manager.getState().remainingDistanceM! / 1.16
    expect(test.manager.getState().remainingDurationSeconds).toBeCloseTo(
      beforeRecentSpeedAdoption +
        (rawDurationSeconds - beforeRecentSpeedAdoption) * 0.35,
    )
  })

  it('이동 중 표시 ETA는 실제 경과시간만큼 1초 단위로 감소한다', () => {
    const test = setup()
    test.start()
    const longitudes = [0, 0.00002, 0.00004, 0.00006]
    longitudes.forEach((longitude, index) => {
      const timestamp = index * 2_000
      test.setNow(timestamp)
      test.position(createPosition(0, longitude, timestamp, 5, 1))
    })
    const beforeTick = test.manager.getState().remainingDurationSeconds!

    test.setNow(7_000)
    test.runDisplayUpdate()

    expect(test.manager.getState().status).toBe('moving')
    expect(test.manager.getState().remainingDurationSeconds).toBeCloseTo(
      beforeTick - 1,
    )
  })

  it('새 GPS가 없으면 ETA를 새 측정값으로 재평가하지 않고 오래되면 멈춘다', () => {
    const test = setup()
    test.start()
    const longitudes = [0, 0.00002, 0.00004, 0.00006]
    longitudes.forEach((longitude, index) => {
      const timestamp = index * 2_000
      test.setNow(timestamp)
      test.position(createPosition(0, longitude, timestamp, 5, 1))
    })
    const beforeSleep = test.manager.getState().remainingDurationSeconds!

    test.setNow(30_000)
    test.runDisplayUpdate()

    expect(test.manager.getState().status).toBe('stale')
    expect(test.manager.getState().remainingDurationSeconds).toBeCloseTo(
      beforeSleep,
    )
  })

  it('정지 중 남은 시간은 유지하고 도착시각만 실제 정지시간만큼 늦춘다', () => {
    const test = setup()
    test.start()
    for (let timestamp = 0; timestamp <= 36_000; timestamp += 2_000) {
      test.setNow(timestamp)
      const jitterLongitude =
        (timestamp / 2_000) % 2 === 0 ? 0 : 0.000001
      test.position(
        createPosition(0, jitterLongitude, timestamp, 5, null),
      )
      test.runDisplayUpdate()
    }

    const state = test.manager.getState()
    expect(state.status).toBe('stationary')
    expect(
      Math.abs(
        state.remainingDurationSeconds! -
          route.distanceM / baselineSpeed.speedMps,
      ),
    ).toBeLessThan(1)
    expect(Date.parse(state.arrivalAt!)).toBeGreaterThan(36_000)
  })

  it('정지 직후 한두 개의 빠른 관측만으로 ETA 적용속도를 바꾸지 않는다', () => {
    const test = setup()
    test.start()
    for (let index = 0; index < 4; index += 1) {
      const timestamp = index * 2_000
      test.setNow(timestamp)
      test.position(createPosition(0, 0, timestamp, 5, 0))
    }

    test.setNow(8_000)
    test.position(createPosition(0, 0.00002, 8_000, 5, 3))
    test.setNow(10_000)
    test.position(createPosition(0, 0.00004, 10_000, 5, 3))

    expect(test.manager.getState().appliedSpeedMps).toBe(
      baselineSpeed.speedMps,
    )
    expect(test.manager.getState().speedSource).toBe('personalized')
  })

  it.each([
    { label: '느린 보행', speedMps: 0.8, expectedDirection: 'below' },
    { label: '빠른 보행', speedMps: 2, expectedDirection: 'above' },
  ])('지속적인 $label 속도는 5초 재평가에 반영한다', ({
    speedMps,
    expectedDirection,
  }) => {
    const test = setup()
    test.start()
    for (let index = 0; index < 10; index += 1) {
      const timestamp = index * 2_000
      test.setNow(timestamp)
      test.position(
        createPosition(0, index * 0.00001, timestamp, 5, speedMps),
      )
    }

    const appliedSpeedMps = test.manager.getState().appliedSpeedMps!
    if (expectedDirection === 'below') {
      expect(appliedSpeedMps).toBeLessThan(baselineSpeed.speedMps)
    } else {
      expect(appliedSpeedMps).toBeGreaterThan(baselineSpeed.speedMps)
    }
  })

  it.each([
    { label: '느린 보행', speedMps: 0.8, expectedDirection: 'below' },
    { label: '빠른 보행', speedMps: 2, expectedDirection: 'above' },
  ])('정지 후 $label 재개는 워밍업 뒤 적용한다', ({
    speedMps,
    expectedDirection,
  }) => {
    const test = setup()
    test.start()
    for (let timestamp = 0; timestamp <= 6_000; timestamp += 2_000) {
      test.setNow(timestamp)
      test.position(createPosition(0, 0, timestamp, 5, 0))
    }

    for (let timestamp = 8_000; timestamp <= 18_000; timestamp += 2_000) {
      test.setNow(timestamp)
      test.position(
        createPosition(
          0,
          ((timestamp - 6_000) / 2_000) * 0.00001,
          timestamp,
          5,
          speedMps,
        ),
      )
    }
    expect(test.manager.getState().appliedSpeedMps).toBe(
      baselineSpeed.speedMps,
    )

    for (let timestamp = 20_000; timestamp <= 24_000; timestamp += 2_000) {
      test.setNow(timestamp)
      test.position(
        createPosition(
          0,
          ((timestamp - 6_000) / 2_000) * 0.00001,
          timestamp,
          5,
          speedMps,
        ),
      )
    }

    const appliedSpeedMps = test.manager.getState().appliedSpeedMps!
    if (expectedDirection === 'below') {
      expect(appliedSpeedMps).toBeLessThan(baselineSpeed.speedMps)
    } else {
      expect(appliedSpeedMps).toBeGreaterThan(baselineSpeed.speedMps)
    }
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
    test.runStaleCheck()
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
