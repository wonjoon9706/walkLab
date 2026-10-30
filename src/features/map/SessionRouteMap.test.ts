import { describe, expect, it } from 'vitest'
import type { RawGpsPoint } from '../../domain/measurement'
import { getRouteCoordinates } from './routeCoordinates'

function point(latitude: number, longitude: number): RawGpsPoint {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    sequenceNo: 1,
    measuredAt: '2026-10-30T00:00:00.000Z',
    receivedAt: '2026-10-30T00:00:00.000Z',
    latitude,
    longitude,
    accuracyM: 5,
    altitudeM: null,
    altitudeAccuracyM: null,
    deviceSpeedMps: null,
    headingDeg: null,
    schemaVersion: 1,
  }
}

describe('지도 좌표 변환', () => {
  it('위도와 경도를 이름으로 구분하고 잘못된 좌표는 제외한다', () => {
    const coordinates = getRouteCoordinates([
      point(37.5, 127.1),
      point(100, 127.1),
    ])

    expect(coordinates).toEqual([{ latitude: 37.5, longitude: 127.1 }])
  })
})
