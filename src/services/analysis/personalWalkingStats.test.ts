import { describe, expect, it, vi } from 'vitest'
import type { WalkHistoryItem, WalkSessionDetail } from '../../domain/history'
import type { LocalWalkSession, RawGpsPoint } from '../../domain/measurement'
import type { WalkHistoryService } from '../history/walkHistoryService'
import {
  analyzePersonalWalkingHistory,
  getAnalysisExclusionReasons,
} from './personalWalkingStats'

function createDetail(sessionId: string, day: number): WalkSessionDetail {
  const startedAt = `2026-10-${day.toString().padStart(2, '0')}T00:00:00.000Z`
  const session: LocalWalkSession = {
    id: sessionId,
    ownerUserId: 'user-1',
    status: 'completed',
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
    installationId: 'installation-1',
    sourcePlatform: 'web',
    appVersion: '0.0.0',
    schemaVersion: 1,
    createdAt: startedAt,
    updatedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
  }
  const latitudeStep = (2 / 6_371_008.8) * (180 / Math.PI)
  const points: RawGpsPoint[] = Array.from({ length: 61 }, (_, index) => {
    const measuredAt = new Date(Date.parse(startedAt) + index * 1000).toISOString()
    return {
      id: `${sessionId}-point-${index}`,
      sessionId,
      sequenceNo: index + 1,
      measuredAt,
      receivedAt: measuredAt,
      latitude: 37 + latitudeStep * index,
      longitude: 127,
      accuracyM: 5,
      altitudeM: null,
      altitudeAccuracyM: null,
      deviceSpeedMps: 2,
      headingDeg: null,
      schemaVersion: 1,
    }
  })
  return { session, points, existsLocally: false, existsOnServer: true }
}

describe('개인 보행 기초 통계', () => {
  it('3개 적합 기록의 총거리와 이동 중 평균속도를 계산한다', async () => {
    const details = new Map([
      ['session-1', createDetail('session-1', 27)],
      ['session-2', createDetail('session-2', 28)],
      ['session-3', createDetail('session-3', 29)],
    ])
    const records: WalkHistoryItem[] = [...details.values()].map((detail) => ({
      id: detail.session.id,
      startedAt: detail.session.startedAt,
      endedAt: detail.session.endedAt as string,
      durationSeconds: 60,
      pointCount: 61,
      source: 'server',
    }))
    const historyService = {
      listCompletedSessions: vi.fn().mockResolvedValue(records),
      getSessionDetail: vi.fn(async (_ownerUserId: string, sessionId: string) =>
        details.get(sessionId) ?? null,
      ),
      analyzeAndSave: vi.fn(),
    } as WalkHistoryService

    const summary = await analyzePersonalWalkingHistory(
      'user-1',
      records,
      historyService,
    )

    expect(summary.eligibleSessionCount).toBe(3)
    expect(summary.excludedSessionCount).toBe(0)
    expect(summary.totalDistanceM).toBeCloseTo(360, 0)
    expect(summary.averageMovingSpeedMps).toBeCloseTo(2, 1)
    expect(summary.hasEnoughSamples).toBe(true)
  })

  it('짧고 품질이 낮은 기록을 분석 대상에서 구분한다', () => {
    const reasons = getAnalysisExclusionReasons({
      metrics: {
        sessionId: 'session-short',
        durationSeconds: 30,
        rawDistanceM: 20,
        filteredDistanceM: 10,
        averageSpeedMps: 0.3,
        paceSecondsPerKm: 3000,
        altitudeMinM: null,
        altitudeMaxM: null,
        altitudeSampleCount: 0,
        rawPointCount: 10,
        filteredPointCount: 2,
        calculatedAt: '2026-10-30T00:00:30.000Z',
        algorithmVersion: 'metrics-v1',
        qualityAlgorithmVersion: 'quality-v1',
      },
    })

    expect(reasons).toEqual([
      'too_short',
      'too_little_distance',
      'too_few_points',
      'low_quality',
    ])
  })
})
