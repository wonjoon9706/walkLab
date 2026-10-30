import { describe, expect, it } from 'vitest'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { calculateWalkingEta, selectWalkingSpeedProfile } from './walkingEta'

function createModel(
  overrides: Partial<WalkingSpeedModel> = {},
): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1',
    status: 'ready',
    estimatedSpeedMps: 1.5,
    simpleAverageSpeedMps: 1.4,
    validSessionCount: 4,
    windowDays: 30,
    trainingPeriodStart: '2026-10-01T00:00:00.000Z',
    trainingPeriodEnd: '2026-10-29T00:00:00.000Z',
    lastUpdatedAt: '2026-10-29T00:00:00.000Z',
    calculatedAt: '2026-10-30T00:00:00.000Z',
    estimatedOneKilometerSeconds: 1000 / 1.5,
    decisions: [],
    ...overrides,
  }
}

describe('G8 보행 ETA', () => {
  it('준비된 G7 개인속도를 경로 거리에 적용한다', () => {
    const calculatedAt = new Date('2026-10-30T00:00:00.000Z')
    const eta = calculateWalkingEta(
      1500,
      1100,
      createModel(),
      calculatedAt,
    )

    expect(eta.appliedDurationSeconds).toBe(1000)
    expect(eta.defaultDurationSeconds).toBeCloseTo(1125)
    expect(eta.speedProfile).toMatchObject({
      source: 'personalized',
      speedMps: 1.5,
      validSessionCount: 4,
    })
    expect(eta.arrivalAt).toBe('2026-10-30T00:16:40.000Z')
  })

  it.each([
    null,
    createModel({ status: 'insufficient' }),
    createModel({ estimatedSpeedMps: null }),
    createModel({ estimatedSpeedMps: Number.NaN }),
  ])('학습값이 준비되지 않으면 기본속도를 사용한다', (model) => {
    const profile = selectWalkingSpeedProfile(model)
    expect(profile.source).toBe('default')
    expect(profile.speedMps).toBeCloseTo(4.8 / 3.6)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '잘못된 거리 %s를 거부한다',
    (distanceM) => {
      expect(() => calculateWalkingEta(distanceM, 60, null)).toThrow(
        'INVALID_ROUTE_DISTANCE',
      )
    },
  )
})
