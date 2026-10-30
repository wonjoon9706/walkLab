import { describe, expect, it } from 'vitest'
import type { SessionComparison } from '../../domain/movementAnalysis'
import {
  backtestWalkingSpeedModel,
  trainWalkingSpeedModel,
} from './walkingSpeedModel'

const AS_OF = new Date('2026-10-30T00:00:00.000Z')

function comparison(
  id: string,
  daysAgo: number,
  movingSpeedMps: number | null,
  options: { eligible?: boolean; movingDurationSeconds?: number } = {},
): SessionComparison {
  const startedAt = new Date(
    AS_OF.getTime() - daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString()
  const eligible = options.eligible ?? true
  const movingDurationSeconds = options.movingDurationSeconds ?? 600
  return {
    sessionId: id,
    startedAt,
    eligible,
    exclusionReasons: eligible ? [] : ['low_quality'],
    metrics: {
      sessionId: id,
      durationSeconds: 600,
      rawDistanceM: 1000,
      filteredDistanceM: 950,
      averageSpeedMps: 1.58,
      paceSecondsPerKm: 632,
      altitudeMinM: null,
      altitudeMaxM: null,
      altitudeSampleCount: 0,
      rawPointCount: 600,
      filteredPointCount: eligible ? 590 : 100,
      calculatedAt: startedAt,
      algorithmVersion: 'metrics-v1',
      qualityAlgorithmVersion: 'quality-v1',
    },
    movement: {
      algorithmVersion: 'movement-v1',
      qualityAlgorithmVersion: 'quality-v1',
      segments: [],
      movingDurationSeconds,
      stationaryDurationSeconds: 0,
      uncertainDurationSeconds: 0,
      movingDistanceM:
        movingSpeedMps === null ? 0 : movingSpeedMps * movingDurationSeconds,
      movingAverageSpeedMps: movingSpeedMps,
    },
  }
}

describe('recency-weighted-v1', () => {
  it('최근 세션에 더 높은 가중치를 주되 한 세션을 50% 이하로 제한한다', () => {
    const model = trainWalkingSpeedModel(
      [
        comparison('old', 30, 1),
        comparison('middle', 15, 1.5),
        comparison('new', 0, 2),
      ],
      { asOf: AS_OF },
    )
    const oldWeight = model.decisions.find((item) => item.sessionId === 'old')?.weight ?? 0
    const newWeight = model.decisions.find((item) => item.sessionId === 'new')?.weight ?? 0
    const totalWeight = model.decisions.reduce(
      (sum, item) => sum + (item.weight ?? 0),
      0,
    )

    expect(model.status).toBe('ready')
    expect(model.windowDays).toBe(30)
    expect(newWeight).toBeGreaterThan(oldWeight)
    expect(newWeight).toBeLessThanOrEqual(0.5)
    expect(totalWeight).toBeCloseTo(1)
    expect(model.estimatedSpeedMps).toBeGreaterThan(model.simpleAverageSpeedMps ?? 0)
  })

  it('최근 30일 기록이 부족하면 90일까지 확대하고 더 오래된 기록은 제외한다', () => {
    const model = trainWalkingSpeedModel(
      [
        comparison('recent-1', 1, 1.5),
        comparison('recent-2', 10, 1.6),
        comparison('fallback', 60, 1.4),
        comparison('too-old', 91, 2),
      ],
      { asOf: AS_OF },
    )

    expect(model.windowDays).toBe(90)
    expect(model.validSessionCount).toBe(3)
    expect(model.decisions.find((item) => item.sessionId === 'fallback')?.included).toBe(true)
    expect(
      model.decisions.find((item) => item.sessionId === 'too-old')?.exclusionReasons,
    ).toContain('outside_learning_window')
  })

  it('세션이 부족하면 계산값을 참고용으로만 표시한다', () => {
    const model = trainWalkingSpeedModel(
      [comparison('one', 1, 1.4), comparison('two', 2, 1.5)],
      { asOf: AS_OF },
    )

    expect(model.status).toBe('insufficient')
    expect(model.validSessionCount).toBe(2)
    expect(model.estimatedSpeedMps).not.toBeNull()
  })

  it('새 기록은 다음 계산에 반영되지만 긴 세션이라고 추가 가중하지 않는다', () => {
    const base = [
      comparison('one', 20, 1.5),
      comparison('two', 10, 1.5),
      comparison('three', 5, 1.5),
    ]
    const before = trainWalkingSpeedModel(base, { asOf: AS_OF })
    const normalNew = trainWalkingSpeedModel(
      [...base, comparison('new', 0, 2, { movingDurationSeconds: 600 })],
      { asOf: AS_OF },
    )
    const longNew = trainWalkingSpeedModel(
      [...base, comparison('new', 0, 2, { movingDurationSeconds: 7200 })],
      { asOf: AS_OF },
    )

    expect(normalNew.estimatedSpeedMps).toBeGreaterThan(before.estimatedSpeedMps ?? 0)
    expect(longNew.estimatedSpeedMps).toBeCloseTo(normalNew.estimatedSpeedMps ?? 0)
  })

  it('G6 기준을 통과한 느린 보행은 학습에서 제외하지 않는다', () => {
    const model = trainWalkingSpeedModel(
      [
        comparison('slow', 1, 0.6),
        comparison('normal-1', 2, 1.4),
        comparison('normal-2', 3, 1.5),
        comparison('bad-gps', 4, 2, { eligible: false }),
      ],
      { asOf: AS_OF },
    )

    expect(model.decisions.find((item) => item.sessionId === 'slow')?.included).toBe(true)
    expect(model.decisions.find((item) => item.sessionId === 'bad-gps')?.included).toBe(false)
  })

  it('향후 사용자 제외 기능을 위한 세션 ID 입력을 지원한다', () => {
    const model = trainWalkingSpeedModel(
      [
        comparison('excluded-by-user', 1, 2),
        comparison('one', 2, 1.4),
        comparison('two', 3, 1.5),
        comparison('three', 4, 1.6),
      ],
      {
        asOf: AS_OF,
        manuallyExcludedSessionIds: new Set(['excluded-by-user']),
      },
    )

    expect(
      model.decisions.find((item) => item.sessionId === 'excluded-by-user')
        ?.exclusionReasons,
    ).toContain('manually_excluded')
    expect(model.validSessionCount).toBe(3)
  })

  it('백테스트는 대상 기록 이후 데이터를 이전 예측에 사용하지 않는다', () => {
    const firstFive = [
      comparison('one', 50, 1),
      comparison('two', 40, 1.1),
      comparison('three', 30, 1.2),
      comparison('four', 20, 1.3),
      comparison('five', 10, 1.4),
    ]
    const withFuture = [
      ...firstFive,
      comparison('future', 0, 3),
    ]
    const firstBacktest = backtestWalkingSpeedModel(firstFive)
    const futureBacktest = backtestWalkingSpeedModel(withFuture)

    expect(firstBacktest.status).toBe('ready')
    expect(firstBacktest.evaluationSessionCount).toBe(2)
    expect(futureBacktest.cases[0]).toEqual(firstBacktest.cases[0])
    expect(firstBacktest.cases[0].trainingSessionCount).toBe(3)
  })
})
