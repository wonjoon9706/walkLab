import { describe, expect, it } from 'vitest'
import type { LocalWalkSession, RawGpsPoint } from '../../domain/measurement'
import {
  analyzeWalkSession,
  calculateHaversineDistance,
} from './walkingAnalysis'

const session: LocalWalkSession = {
  id: 'session-1',
  ownerUserId: 'user-1',
  status: 'completed',
  startedAt: '2026-10-30T00:00:00.000Z',
  endedAt: '2026-10-30T00:01:40.000Z',
  installationId: 'installation-1',
  sourcePlatform: 'web',
  appVersion: '0.0.0',
  schemaVersion: 1,
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:01:40.000Z',
}

function makePoint(
  sequenceNo: number,
  latitude: number,
  measuredAt: string,
  overrides: Partial<RawGpsPoint> = {},
): RawGpsPoint {
  return {
    id: `point-${sequenceNo}`,
    sessionId: session.id,
    sequenceNo,
    measuredAt,
    receivedAt: measuredAt,
    latitude,
    longitude: 127,
    accuracyM: 5,
    altitudeM: null,
    altitudeAccuracyM: null,
    deviceSpeedMps: null,
    headingDeg: null,
    schemaVersion: 1,
    ...overrides,
  }
}

describe('보행 분석', () => {
  it('285개 GPS 회귀 fixture의 기존 metrics-v1 값을 유지한다', () => {
    const durationSeconds = 285
    const targetDistanceM = 488
    const pointCount = 285
    const latitudeStep =
      (targetDistanceM / (pointCount - 1) / 6_371_008.8) * (180 / Math.PI)
    const excludedIndexes = new Set([20, 40, 60, 80, 100, 120, 140])
    const regressionSession: LocalWalkSession = {
      ...session,
      endedAt: new Date(
        Date.parse(session.startedAt) + durationSeconds * 1000,
      ).toISOString(),
    }
    const points = Array.from({ length: pointCount }, (_, index) =>
      makePoint(
        index + 1,
        index * latitudeStep,
        new Date(Date.parse(session.startedAt) + index * 1000).toISOString(),
        {
          longitude: 0,
          accuracyM: excludedIndexes.has(index) ? 60 : 5,
        },
      ),
    )

    const analysis = analyzeWalkSession(regressionSession, points)

    expect(analysis.metrics.durationSeconds).toBe(285)
    expect(analysis.metrics.rawPointCount).toBe(285)
    expect(analysis.metrics.filteredPointCount).toBe(278)
    expect(analysis.metrics.filteredDistanceM).toBeCloseTo(488, 0)
    expect((analysis.metrics.averageSpeedMps ?? 0) * 3.6).toBeCloseTo(6.16, 2)
  })

  it('Haversine 공식으로 좌표 사이 거리를 계산한다', () => {
    const first = makePoint(1, 0, '2026-10-30T00:00:00.000Z', { longitude: 0 })
    const second = makePoint(2, 0, '2026-10-30T00:00:10.000Z', { longitude: 0.001 })

    expect(calculateHaversineDistance(first, second)).toBeCloseTo(111.2, 1)
  })

  it('좌표 튐은 제외하고 전체 측정시간으로 평균 속도를 계산한다', () => {
    const points = [
      makePoint(1, 37, '2026-10-30T00:00:00.000Z'),
      makePoint(2, 37.00001, '2026-10-30T00:00:10.000Z'),
      makePoint(3, 37.01, '2026-10-30T00:00:11.000Z'),
    ]
    const analysis = analyzeWalkSession(session, points, '2026-10-30T01:00:00.000Z')

    expect(analysis.quality[2].reasons).toContain('implausible_walking_speed')
    expect(analysis.metrics.filteredPointCount).toBe(2)
    expect(analysis.metrics.durationSeconds).toBe(100)
    expect(analysis.metrics.averageSpeedMps).toBeCloseTo(
      analysis.metrics.filteredDistanceM / 100,
    )
  })

  it('낮은 정확도, 오래된 수신, 역행 시간을 별도 사유로 남긴다', () => {
    const points = [
      makePoint(1, 37, '2026-10-30T00:00:10.000Z'),
      makePoint(2, 37, '2026-10-30T00:00:20.000Z', { accuracyM: 80 }),
      makePoint(3, 37, '2026-10-30T00:00:30.000Z', {
        receivedAt: '2026-10-30T00:01:01.000Z',
      }),
      makePoint(4, 37, '2026-10-30T00:00:09.000Z'),
      makePoint(5, 100, '2026-10-30T00:00:40.000Z'),
    ]
    const analysis = analyzeWalkSession(session, points)

    expect(analysis.quality[1].reasons).toContain('low_accuracy')
    expect(analysis.quality[2].reasons).toContain('stale_position')
    expect(analysis.quality[3].reasons).toContain('non_monotonic_time')
    expect(analysis.quality[4].reasons).toContain('invalid_coordinate')
  })

  it('분석 중 원본 GPS 배열과 지점을 변경하지 않는다', () => {
    const points = [
      makePoint(2, 37.00001, '2026-10-30T00:00:10.000Z'),
      makePoint(1, 37, '2026-10-30T00:00:00.000Z'),
    ]
    const before = JSON.stringify(points)

    analyzeWalkSession(session, points)

    expect(JSON.stringify(points)).toBe(before)
  })

  it('0초 또는 음수 시간에는 속도와 페이스를 계산하지 않는다', () => {
    const zeroDurationSession = {
      ...session,
      endedAt: session.startedAt,
    }
    const negativeDurationSession = {
      ...session,
      endedAt: '2026-10-29T23:59:59.000Z',
    }
    const points = [makePoint(1, 37, session.startedAt)]

    const zeroResult = analyzeWalkSession(zeroDurationSession, points)
    const negativeResult = analyzeWalkSession(negativeDurationSession, points)

    expect(zeroResult.metrics.averageSpeedMps).toBeNull()
    expect(zeroResult.metrics.paceSecondsPerKm).toBeNull()
    expect(negativeResult.metrics.durationSeconds).toBeNull()
  })

  it('중단 세션은 마지막 수신 시각으로 duration을 계산하고 null 고도를 유지한다', () => {
    const interruptedSession: LocalWalkSession = {
      ...session,
      status: 'interrupted',
      endedAt: null,
    }
    const points = [
      makePoint(1, 37, '2026-10-30T00:00:10.000Z'),
      makePoint(2, 37.00001, '2026-10-30T00:00:25.000Z'),
    ]
    const analysis = analyzeWalkSession(interruptedSession, points)

    expect(analysis.metrics.durationSeconds).toBe(25)
    expect(analysis.metrics.altitudeMinM).toBeNull()
    expect(analysis.metrics.altitudeMaxM).toBeNull()
    expect(analysis.metrics.altitudeSampleCount).toBe(0)
  })
})
