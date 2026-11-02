import { describe, expect, it } from 'vitest'
import type { WalkingRoute } from '../../domain/walkingRoute'
import {
  calculateCoordinateGapM,
  calculateWalkingRouteEndpointGaps,
} from './walkingRouteDiagnostics'

describe('도보 경로 요청점과 실제 경로 끝점 비교', () => {
  it('요청 출발·도착 좌표와 경로 첫·마지막 좌표의 간격을 계산한다', () => {
    const route: WalkingRoute = {
      distanceM: 100,
      providerDurationSeconds: 80,
      coordinates: [
        { latitude: 37.5, longitude: 127.0001 },
        { latitude: 37.5005, longitude: 127.0009 },
      ],
      provider: 'kakao-walking-route',
      requestedAt: '2026-11-02T00:00:00.000Z',
    }

    const result = calculateWalkingRouteEndpointGaps(
      route,
      { latitude: 37.5, longitude: 127 },
      { latitude: 37.5005, longitude: 127.001 },
    )

    expect(result).not.toBeNull()
    expect(result!.startGapM).toBeGreaterThan(8)
    expect(result!.startGapM).toBeLessThan(10)
    expect(result!.destinationGapM).toBeGreaterThan(8)
    expect(result!.destinationGapM).toBeLessThan(10)
  })

  it('동일 좌표의 거리는 0m다', () => {
    const coordinate = { latitude: 37.5, longitude: 127 }
    expect(calculateCoordinateGapM(coordinate, coordinate)).toBe(0)
  })
})
