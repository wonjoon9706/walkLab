import { describe, expect, it } from 'vitest'
import type { LocalWalkSession, RawGpsPoint } from '../../domain/measurement'
import { analyzeWalkSession } from './walkingAnalysis'
import { analyzeMovement } from './movementAnalysis'

function session(endedAt = '2026-10-30T00:00:30.000Z'): LocalWalkSession {
  return {
    id: 'session-1',
    ownerUserId: 'user-1',
    status: 'completed',
    startedAt: '2026-10-30T00:00:00.000Z',
    endedAt,
    installationId: 'installation-1',
    sourcePlatform: 'web',
    appVersion: '0.0.0',
    schemaVersion: 1,
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: endedAt,
  }
}

function point(
  sequenceNo: number,
  second: number,
  latitude: number,
  deviceSpeedMps: number | null,
  accuracyM = 5,
): RawGpsPoint {
  const measuredAt = new Date(
    Date.parse('2026-10-30T00:00:00.000Z') + second * 1000,
  ).toISOString()
  return {
    id: `point-${sequenceNo}`,
    sessionId: 'session-1',
    sequenceNo,
    measuredAt,
    receivedAt: measuredAt,
    latitude,
    longitude: 127,
    accuracyM,
    altitudeM: null,
    altitudeAccuracyM: null,
    deviceSpeedMps,
    headingDeg: null,
    schemaVersion: 1,
  }
}

describe('movement-v1', () => {
  it('정지, 이동과 GPS 수신 공백을 서로 다르게 분류한다', () => {
    const points = [
      point(1, 0, 37, 0),
      point(2, 1, 37, 0),
      point(3, 2, 37, 0),
      point(4, 3, 37, 0),
      point(5, 4, 37, 0),
      point(6, 5, 37, 0),
      point(7, 6, 37.00001, 1.1),
      point(8, 7, 37.00002, 1.1),
      point(9, 8, 37.00003, 1.1),
      point(10, 9, 37.00004, 1.1),
      point(11, 10, 37.00005, 1.1),
      point(12, 25, 37.00006, 1.1),
      point(13, 26, 37.00007, 1.1),
    ]
    const base = analyzeWalkSession(session(), points)
    const result = analyzeMovement(session(), points, base)

    expect(result.stationaryDurationSeconds).toBeGreaterThan(0)
    expect(result.movingDurationSeconds).toBeGreaterThan(0)
    expect(result.uncertainDurationSeconds).toBeGreaterThanOrEqual(15)
    expect(result.movingAverageSpeedMps).toBeGreaterThan(0)
  })

  it('품질 판정에서 제외된 GPS 튐 구간을 판정 불가로 유지한다', () => {
    const points = [
      point(1, 0, 37, 1),
      point(2, 1, 37.01, 1),
      point(3, 2, 37.00001, 1),
    ]
    const base = analyzeWalkSession(session('2026-10-30T00:00:02.000Z'), points)
    const result = analyzeMovement(
      session('2026-10-30T00:00:02.000Z'),
      points,
      base,
    )

    expect(base.quality.some((quality) => quality.status === 'excluded')).toBe(true)
    expect(result.segments.every((segment) => segment.state === 'uncertain')).toBe(true)
  })

  it('분석 전후 GPS 원본을 변경하지 않는다', () => {
    const points = [point(1, 0, 37, 0), point(2, 1, 37, 0)]
    const before = JSON.stringify(points)
    const base = analyzeWalkSession(session(), points)

    analyzeMovement(session(), points, base)

    expect(JSON.stringify(points)).toBe(before)
  })
})
