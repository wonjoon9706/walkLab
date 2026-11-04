import { describe, expect, it } from 'vitest'
import type { BusArrivalInfo } from '../../domain/busArrival'
import type { SubwayArrivalInfo } from '../../domain/subwayArrival'
import type { TransitItinerary, TransitRouteLeg } from '../../domain/transitRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import {
  calculateTransitWalkingLeg,
  composeTransitBoardingPlan,
} from './transitBoarding'

const now = new Date('2026-11-03T07:00:00.000Z')

function readyModel(speedMps = 2): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1', status: 'ready',
    estimatedSpeedMps: speedMps, simpleAverageSpeedMps: speedMps,
    validSessionCount: 5, windowDays: 30,
    trainingPeriodStart: null, trainingPeriodEnd: null,
    lastUpdatedAt: now.toISOString(), calculatedAt: now.toISOString(),
    estimatedOneKilometerSeconds: 1000 / speedMps, decisions: [],
  }
}

function leg(mode: TransitRouteLeg['mode'], overrides: Partial<TransitRouteLeg> = {}): TransitRouteLeg {
  return {
    mode, distanceM: mode === 'WALK' ? 320 : 3_000,
    durationSeconds: mode === 'WALK' ? 300 : 600,
    routeName: mode === 'WALK' ? null : '노선', routeColor: null,
    routeType: mode === 'SUBWAY' ? 7 : mode === 'BUS' ? 11 : null,
    startName: '출발', endName: '도착', coordinates: [],
    ...overrides,
  }
}

function itinerary(legs: TransitRouteLeg[]): TransitItinerary {
  return {
    id: 'route', totalDurationSeconds: legs.reduce((sum, item) => sum + item.durationSeconds, 0),
    totalWalkDurationSeconds: legs.filter((item) => item.mode === 'WALK').reduce((sum, item) => sum + item.durationSeconds, 0),
    totalWalkDistanceM: legs.filter((item) => item.mode === 'WALK').reduce((sum, item) => sum + item.distanceM, 0),
    totalDistanceM: legs.reduce((sum, item) => sum + item.distanceM, 0),
    transferCount: 0, fareKrw: 1_500, legs,
  }
}

function busArrival(firstSeconds: number, secondSeconds = 600): BusArrivalInfo {
  return {
    routeName: '302', stopName: '정류장', stopId: 'STOP',
    arrivalSeconds: firstSeconds, remainingStops: 2,
    upcomingArrivals: [
      { order: 1, arrivalSeconds: firstSeconds, remainingStops: 2, message: null },
      { order: 2, arrivalSeconds: secondSeconds, remainingStops: 5, message: null },
    ],
    fetchedAt: now.toISOString(), provider: 'seoul', dataMode: 'live',
    status: 'available', walkingTimeToStopSeconds: null,
  }
}

function subwayArrival(): SubwayArrivalInfo {
  return {
    lineName: '7호선', stationName: '어린이대공원', status: 'available',
    estimates: [{
      order: 1, rawArrivalSeconds: 480, dataAgeSeconds: 30,
      arrivalSeconds: 450, direction: '하행', destination: '석남',
      trainType: 'normal', statusCode: '99', statusMessage: '8분 후',
      generatedAt: '2026-11-03T06:59:30.000Z',
    }],
    fetchedAt: now.toISOString(), provider: 'seoul-subway', dataMode: 'live',
  }
}

function arrivals(bus?: BusArrivalInfo, subway?: SubwayArrivalInfo) {
  return {
    bus: new Map(bus === undefined ? [] : [[1, bus]]),
    subway: new Map(subway === undefined ? [] : [[1, subway]]),
  }
}

describe('T2-3 순차 탑승 가능성 계산', () => {
  it('G7 준비 완료 사용자는 거리와 개인속도로 순수 보행시간을 계산한다', () => {
    const estimate = calculateTransitWalkingLeg(leg('WALK'), 0, readyModel(2))
    expect(estimate.pureWalkingDurationSeconds).toBe(160)
    expect(estimate.tmapDurationSeconds).toBe(300)
    expect(estimate.speedProfile).toMatchObject({
      source: 'personalized', validSessionCount: 5,
    })
    expect(estimate.unverifiedOverheadSeconds).toBeNull()
  })

  it('G7 표본 부족 사용자는 기존 기본속도를 사용한다', () => {
    const insufficient: WalkingSpeedModel = {
      ...readyModel(),
      status: 'insufficient',
      estimatedSpeedMps: null,
      validSessionCount: 2,
    }
    const estimate = calculateTransitWalkingLeg(leg('WALK'), 0, insufficient)
    expect(estimate.speedProfile.source).toBe('default')
    expect(estimate.speedProfile.validSessionCount).toBe(2)
    expect(estimate.pureWalkingDurationSeconds).toBe(240)
  })

  it('빠른 속도와 느린 속도의 차이를 TMAP 원본과 별도로 유지한다', () => {
    const walking = leg('WALK')
    expect(calculateTransitWalkingLeg(walking, 0, readyModel(2)).pureWalkingDurationSeconds).toBe(160)
    expect(calculateTransitWalkingLeg(walking, 0, readyModel(1)).pureWalkingDurationSeconds).toBe(320)
  })

  it('버스 도착 전에 충분히 도착하면 가능성 높음으로 분류한다', () => {
    const plan = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('BUS')]), readyModel(2), arrivals(busArrival(400)), now,
    )
    expect(plan.boardings[0]).toMatchObject({ status: 'likely', selectedOrder: 1 })
    expect(plan.boardings[0].candidates[0].marginSeconds).toBe(240)
  })

  it('여유 30~119초는 촉박, 30초 미만은 어려움으로 분류한다', () => {
    const tight = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('BUS')]), readyModel(2), arrivals(busArrival(220, 230)), now,
    )
    expect(tight.boardings[0].candidates.map((item) => item.likelihood)).toEqual(['tight', 'tight'])
    const missed = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('BUS')]), readyModel(2), arrivals(busArrival(170, 180)), now,
    )
    expect(missed.boardings[0].status).toBe('unlikely')
  })

  it('첫 버스가 어렵고 두 번째 버스에 여유가 있으면 두 번째를 후보로 선택한다', () => {
    const plan = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('BUS')]), readyModel(2), arrivals(busArrival(170, 400)), now,
    )
    expect(plan.boardings[0].candidates[0].likelihood).toBe('unlikely')
    expect(plan.boardings[0]).toMatchObject({ status: 'likely', selectedOrder: 2 })
  })

  it('0초와 남은 정류장 수가 모순된 차량은 탑승 가능성 계산에서 제외한다', () => {
    const contradictory = busArrival(0, 0)
    if (contradictory.status !== 'available') throw new Error('TEST_SETUP_FAILED')
    contradictory.upcomingArrivals = contradictory.upcomingArrivals?.map(
      (estimate) => ({
        ...estimate,
        remainingStops: null,
        serviceStatus: 'departure_waiting' as const,
        arrivalTimeStatus: 'review_required' as const,
      }),
    )
    const plan = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('BUS')]),
      readyModel(2),
      arrivals(contradictory),
      now,
    )

    expect(plan.boardings[0]).toMatchObject({
      status: 'unavailable',
      candidates: [],
      selectedOrder: null,
    })
    expect(plan.boardings[0].message).toContain('일치하지 않아')
  })

  it('지하철은 역 입구 여유만 계산하고 승강장 접근 미확인으로 확정하지 않는다', () => {
    const plan = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('SUBWAY')]), readyModel(2), arrivals(undefined, subwayArrival()), now,
    )
    expect(plan.boardings[0]).toMatchObject({
      status: 'unavailable', platformAccess: 'unknown',
    })
    expect(plan.boardings[0].candidates[0].marginSeconds).toBe(290)
  })

  it('버스 이후 지하철은 현재 열차와 연결하지 않고 환승 시 재조회를 요구한다', () => {
    const plan = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('BUS'), leg('WALK'), leg('SUBWAY')]),
      readyModel(2),
      {
        bus: new Map([[1, busArrival(400)]]),
        subway: new Map([[3, subwayArrival()]]),
      },
      now,
    )
    expect(plan.boardings[1]).toMatchObject({ status: 'requery_required' })
    expect(plan.boardings[1].accessArrivalAt).toBe('2026-11-03T07:19:20.000Z')
    expect(plan.finalArrivalAt).toBeNull()
  })

  it('오래되거나 누락된 실시간 데이터로 열차·버스를 생성하지 않는다', () => {
    const stale = { ...busArrival(400), fetchedAt: '2026-11-03T06:57:00.000Z' }
    const stalePlan = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('BUS')]), readyModel(), arrivals(stale), now,
    )
    expect(stalePlan.boardings[0]).toMatchObject({
      status: 'unavailable', dataFreshness: 'stale', candidates: [],
    })
    const missingPlan = composeTransitBoardingPlan(
      itinerary([leg('WALK'), leg('SUBWAY')]), readyModel(), arrivals(), now,
    )
    expect(missingPlan.boardings[0].message).not.toContain('운행 중단')
  })
})
