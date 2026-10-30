import { describe, expect, it } from 'vitest'
import type { LiveNavigationObservation } from '../../domain/liveNavigation'
import {
  calculateRouteProgress,
  combineWalkingSpeed,
  estimateRecentWalkingSpeed,
} from './liveNavigationAnalysis'
import { liveNavigationConfig } from './liveNavigationConfig'

function observation(
  longitude: number,
  measuredAtMs: number,
  deviceSpeedMps: number | null,
): LiveNavigationObservation {
  return {
    coordinate: { latitude: 0, longitude },
    accuracyM: 5,
    measuredAtMs,
    deviceSpeedMps,
  }
}

describe('실시간 경로 진행도', () => {
  const route = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.001 },
    { latitude: 0, longitude: 0.002 },
  ]

  it('현재 위치를 실제 경로 구간에 투영해 남은 경로 거리를 계산한다', () => {
    const result = calculateRouteProgress(
      route,
      { latitude: 0.0001, longitude: 0.0005 },
      null,
      liveNavigationConfig,
    )

    expect(result).not.toBeNull()
    expect(result!.segmentIndex).toBe(0)
    expect(result!.distanceFromRouteM).toBeGreaterThan(10)
    expect(result!.remainingDistanceM).toBeGreaterThan(160)
    expect(result!.remainingDistanceM).toBeLessThan(170)
    expect(result!.remainingCoordinates).toHaveLength(3)
  })

  it('GPS 흔들림으로 진행도가 크게 뒤로 가지 않게 제한한다', () => {
    const previous = calculateRouteProgress(
      route,
      { latitude: 0, longitude: 0.0015 },
      null,
      liveNavigationConfig,
    )!
    const next = calculateRouteProgress(
      route,
      { latitude: 0, longitude: 0.001 },
      previous,
      liveNavigationConfig,
    )!

    expect(next.traveledDistanceM).toBeGreaterThanOrEqual(
      previous.traveledDistanceM -
        liveNavigationConfig.maximumProgressBacktrackM,
    )
  })
})

describe('최근 보행속도', () => {
  it('여러 구간의 순간값 대신 중앙값과 학습속도를 결합한다', () => {
    const observations = [
      observation(0, 0, null),
      observation(0.00002, 2_000, 1),
      observation(0.00004, 4_000, 1.1),
      observation(0.00006, 6_000, 0.9),
    ]
    const recent = estimateRecentWalkingSpeed(
      observations,
      liveNavigationConfig,
    )
    const combined = combineWalkingSpeed(recent, 1.4, liveNavigationConfig)

    expect(recent.state).toBe('moving')
    expect(recent.speedMps).toBe(1)
    expect(combined.usesRecentSpeed).toBe(true)
    expect(combined.speedMps).toBeCloseTo(1.16)
  })

  it('정지 상태에서도 ETA 계산용 속도는 학습속도로 유지한다', () => {
    const observations = [
      observation(0, 0, 0),
      observation(0, 2_000, 0),
      observation(0, 4_000, 0),
      observation(0, 6_000, 0),
    ]
    const recent = estimateRecentWalkingSpeed(
      observations,
      liveNavigationConfig,
    )
    const combined = combineWalkingSpeed(recent, 1.3, liveNavigationConfig)

    expect(recent.state).toBe('stationary')
    expect(recent.speedMps).toBe(0)
    expect(combined).toEqual({ speedMps: 1.3, usesRecentSpeed: false })
  })

  it('GPS 수신 공백을 정지로 단정하지 않는다', () => {
    const observations = [
      observation(0, 0, 0),
      observation(0, 2_000, 0),
      observation(0, 4_000, 0),
      observation(0, 19_000, 0),
    ]

    expect(
      estimateRecentWalkingSpeed(observations, liveNavigationConfig),
    ).toEqual({ state: 'uncertain', speedMps: null, validSegmentCount: 0 })
  })

  it('좌표 튐과 비정상 장치 속도를 유효 속도로 사용하지 않는다', () => {
    const observations = [
      observation(0, 0, null),
      observation(0.01, 1_000, 20),
      observation(0.02, 2_000, 20),
      observation(0.03, 3_000, 20),
    ]

    expect(
      estimateRecentWalkingSpeed(observations, liveNavigationConfig).state,
    ).toBe('uncertain')
  })
})
