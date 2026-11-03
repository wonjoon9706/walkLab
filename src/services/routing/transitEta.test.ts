import { describe, expect, it } from 'vitest'
import type { TransitItinerary } from '../../domain/transitRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { auditTransitDurations, calculateTransitEta } from './transitEta'

const itinerary: TransitItinerary = {
  id: 'route-1',
  totalDurationSeconds: 1000,
  totalWalkDurationSeconds: 400,
  totalWalkDistanceM: 500,
  totalDistanceM: 5000,
  transferCount: 1,
  fareKrw: 1500,
  legs: [],
}

function createReadyModel(speedMps: number): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1',
    status: 'ready',
    estimatedSpeedMps: speedMps,
    simpleAverageSpeedMps: speedMps,
    validSessionCount: 5,
    windowDays: 30,
    trainingPeriodStart: '2026-10-01T00:00:00.000Z',
    trainingPeriodEnd: '2026-11-01T00:00:00.000Z',
    lastUpdatedAt: '2026-11-01T00:00:00.000Z',
    calculatedAt: '2026-11-02T00:00:00.000Z',
    estimatedOneKilometerSeconds: 1000 / speedMps,
    decisions: [],
  }
}

describe('대중교통 개인화 ETA', () => {
  it('대중교통 600초는 유지하고 도보 거리만 개인속도로 다시 계산한다', () => {
    const eta = calculateTransitEta(
      itinerary,
      createReadyModel(2),
      new Date('2026-11-02T00:00:00.000Z'),
    )

    expect(eta.personalizedWalkDurationSeconds).toBe(250)
    expect(eta.appliedDurationSeconds).toBe(850)
    expect(eta.providerDurationSeconds).toBe(1000)
    expect(eta.speedProfile.source).toBe('personalized')
  })

  it('학습 데이터가 부족하면 TMAP 기본시간을 유지한다', () => {
    const eta = calculateTransitEta(
      itinerary,
      null,
      new Date('2026-11-02T00:00:00.000Z'),
    )

    expect(eta.personalizedWalkDurationSeconds).toBeNull()
    expect(eta.appliedDurationSeconds).toBe(1000)
    expect(eta.speedProfile.source).toBe('default')
  })

  it('TMAP 구간 합계와 개인화 보정 차이를 서로 분리한다', () => {
    const observedItinerary: TransitItinerary = {
      ...itinerary,
      totalDurationSeconds: 3885,
      totalWalkDurationSeconds: 472,
      totalWalkDistanceM: 444,
      legs: [
        { mode: 'WALK', distanceM: 200, durationSeconds: 248, routeName: null, routeColor: null, startName: '출발', endName: '정류장', coordinates: [] },
        { mode: 'BUS', distanceM: 4000, durationSeconds: 3413, routeName: '직행좌석', routeColor: null, startName: '정류장', endName: '하차', coordinates: [] },
        { mode: 'WALK', distanceM: 244, durationSeconds: 224, routeName: null, routeColor: null, startName: '하차', endName: '도착', coordinates: [] },
      ],
    }
    const eta = calculateTransitEta(
      observedItinerary,
      createReadyModel(1.5),
      new Date('2026-11-02T00:00:00.000Z'),
    )
    const audit = auditTransitDurations(observedItinerary, eta)

    expect(audit.legDurationSumSeconds).toBe(3885)
    expect(audit.providerToLegDifferenceSeconds).toBe(0)
    expect(eta.appliedDurationSeconds).toBe(3709)
    expect(audit.personalizationAdjustmentSeconds).toBe(-176)
  })
})
