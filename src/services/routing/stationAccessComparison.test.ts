import { describe, expect, it } from 'vitest'
import type { TransitBoardingPlan } from '../../domain/transitBoarding'
import type { TransitItinerary, TransitRouteLeg } from '../../domain/transitRoute'
import type { WalkingRoute } from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import {
  compareStationAccessOptions,
  findStationAccessComparisonContext,
  stationAccessComparisonPolicy,
} from './stationAccessComparison'

const now = '2026-11-03T07:00:00.000Z'
const point = { latitude: 37.548, longitude: 127.066 }

function leg(
  mode: TransitRouteLeg['mode'],
  overrides: Partial<TransitRouteLeg> = {},
): TransitRouteLeg {
  return {
    mode,
    distanceM: mode === 'WALK' ? 200 : 2_000,
    durationSeconds: mode === 'WALK' ? 180 : 183,
    routeName: mode === 'BUS' ? '302' : mode === 'SUBWAY' ? '7호선' : null,
    routeColor: null,

    startName: '시작',
    endName: '끝',
    coordinates: [],
    ...overrides,
  }
}

function itinerary(overrides: Partial<TransitRouteLeg>[] = []): TransitItinerary {
  const legs = [
    leg('WALK', overrides[0]),
    leg('BUS', overrides[1]),
    leg('WALK', {
      distanceM: 256,
      durationSeconds: 240,
      endName: '어린이대공원역 접근점',
      endCoordinate: point,
      ...overrides[2],
    }),
    leg('SUBWAY', {
      startName: '어린이대공원',
      startCoordinate: { latitude: 37.54801, longitude: 127.06601 },
      ...overrides[3],
    }),
  ]
  return {
    id: 'route',
    totalDurationSeconds: 1_000,
    totalWalkDurationSeconds: 420,
    totalWalkDistanceM: 456,
    totalDistanceM: 4_000,
    transferCount: 1,
    fareKrw: 1_500,
    legs,
  }
}

function model(status: 'ready' | 'insufficient' = 'ready'): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1',
    status,
    estimatedSpeedMps: status === 'ready' ? 2 : null,
    simpleAverageSpeedMps: status === 'ready' ? 2 : null,
    validSessionCount: status === 'ready' ? 5 : 1,
    windowDays: 30,
    trainingPeriodStart: null,
    trainingPeriodEnd: null,
    lastUpdatedAt: now,
    calculatedAt: now,
    estimatedOneKilometerSeconds: status === 'ready' ? 500 : null,
    decisions: [],
  }
}

function plan(
  selectedOrder: 1 | 2 | null = 2,
  freshness: 'fresh' | 'stale' = 'fresh',
): TransitBoardingPlan {
  return {
    calculatedAt: now,
    walkingLegs: [{
      legIndex: 2,
      distanceM: 256,
      providerDurationSeconds: 240,
      pureWalkingDurationSeconds: 128,
      speedProfile: {
        speedMps: 2,
        source: 'personalized',
        modelVersion: 'recency-weighted-v1',
        validSessionCount: 5,
      },
      unverifiedOverheadSeconds: null,
    }],
    boardings: [{
      legIndex: 1,
      mode: 'BUS',
      status: selectedOrder === null ? 'unlikely' : 'likely',
      dataFreshness: freshness,
      accessDurationSeconds: 135,
      accessArrivalAt: '2026-11-03T07:02:15.000Z',
      platformAccess: 'not_required',
      candidates: [
        {
          order: 1,
          serviceArrivalAt: '2026-11-03T07:00:05.000Z',
          accessArrivalAt: '2026-11-03T07:02:15.000Z',
          marginSeconds: -130,
          likelihood: 'unlikely',
          destination: null,
        },
        {
          order: 2,
          serviceArrivalAt: '2026-11-03T07:11:14.000Z',
          accessArrivalAt: '2026-11-03T07:02:15.000Z',
          marginSeconds: 539,
          likelihood: 'likely',
          destination: null,
        },
      ],
      selectedOrder,
      message: '보장하지 않습니다.',
    }],
    finalArrivalAt: null,
  }
}

function walkingRoute(durationSeconds: number, distanceM = durationSeconds * 2): WalkingRoute {
  return {
    distanceM,
    providerDurationSeconds: durationSeconds + 60,
    coordinates: [{ latitude: 37.54, longitude: 127.06 }, point],
    provider: 'kakao-walking-route',
    requestedAt: now,
  }
}

describe('T2-4A 역 접근 비교', () => {
  it('버스 후 도보 종료점과 지하철 시작점이 30m 이내일 때만 같은 비교 지점으로 사용한다', () => {
    const ready = findStationAccessComparisonContext(itinerary())
    expect(ready.status).toBe('ready')
    if (ready.status === 'ready') {
      expect(ready.context.targetCoordinate).toEqual(point)
      expect(ready.context.endpointGapM).toBeLessThan(30)
    }

    expect(findStationAccessComparisonContext(itinerary([
      {}, {}, { endCoordinate: undefined }, {},
    ])).status).toBe('endpoint_unavailable')
    expect(findStationAccessComparisonContext(itinerary([
      {}, {}, {}, { startCoordinate: { latitude: 37.55, longitude: 127.07 } },
    ])).status).toBe('endpoint_mismatch')
  })

  it('첫 버스를 놓치고 선택된 두 번째 버스부터 승차·후속 보행만 합산한다', () => {
    const context = findStationAccessComparisonContext(itinerary())
    expect(context.status).toBe('ready')
    if (context.status !== 'ready') return
    const result = compareStationAccessOptions(
      itinerary(), context.context, plan(), walkingRoute(1_200), model(),
    )
    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.comparison.selectedBusOrder).toBe(2)
    // 11:14 대기 + 버스 3:03 + 후속 순수 보행 2:08. 첫 도보 2:15는 중복하지 않는다.
    expect(result.comparison.busDurationSeconds).toBe(985)
    expect(result.comparison.busArrivalAt).toBe('2026-11-03T07:16:25.000Z')
  })

  it.each([
    [600, 'direct_walk_faster'],
    [1_400, 'bus_faster'],
    [900, 'similar'],
  ] as const)('직접 도보 %i초를 명시적 2분 기준으로 비교한다', (seconds, outcome) => {
    const context = findStationAccessComparisonContext(itinerary())
    if (context.status !== 'ready') throw new Error('CONTEXT_NOT_READY')
    const result = compareStationAccessOptions(
      itinerary(), context.context, plan(), walkingRoute(seconds), model(),
    )
    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.comparison.outcome).toBe(outcome)
    }
  })

  it('만료된 실시간 정보와 탑승 가능한 차량 부재를 비교 불가로 구분한다', () => {
    const context = findStationAccessComparisonContext(itinerary())
    if (context.status !== 'ready') throw new Error('CONTEXT_NOT_READY')
    expect(compareStationAccessOptions(
      itinerary(), context.context, plan(2, 'stale'), walkingRoute(600), model(),
    ).status).toBe('live_data_stale')
    expect(compareStationAccessOptions(
      itinerary(), context.context, plan(null), walkingRoute(600), model(),
    ).status).toBe('boarding_unavailable')
  })

  it('카카오 경로의 실제 끝점이 비교 지점에서 30m 넘게 벗어나면 비교하지 않는다', () => {
    const context = findStationAccessComparisonContext(itinerary())
    if (context.status !== 'ready') throw new Error('CONTEXT_NOT_READY')
    const route = walkingRoute(600)
    route.coordinates = [
      point,
      { latitude: 37.56, longitude: 127.08 },
    ]
    expect(compareStationAccessOptions(
      itinerary(), context.context, plan(), route, model(),
    ).status).toBe('direct_route_endpoint_mismatch')
  })

  it('G7 미학습 사용자는 기존 기본속도 fallback을 사용한다', () => {
    const context = findStationAccessComparisonContext(itinerary())
    if (context.status !== 'ready') throw new Error('CONTEXT_NOT_READY')
    const result = compareStationAccessOptions(
      itinerary(), context.context, plan(), walkingRoute(600, 800), model('insufficient'),
    )
    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.comparison.directWalkSpeedProfile.source).toBe('default')
      expect(result.comparison.directWalkDurationSeconds).toBe(600)
    }
  })

  it('지원 범위와 작은 차이 기준을 코드 상수로 고정한다', () => {
    expect(stationAccessComparisonPolicy).toEqual({
      endpointMaximumGapM: 30,
      similarMaximumDifferenceSeconds: 120,
    })
    expect(findStationAccessComparisonContext({
      ...itinerary(),
      legs: [leg('WALK'), leg('SUBWAY')],
    }).status).toBe('unsupported_structure')
  })

  it('역 접근 이후 구간이 더 있어도 첫 WALK → BUS → WALK → SUBWAY 계약을 재사용한다', () => {
    const withFollowingLegs = itinerary()
    withFollowingLegs.legs.push(
      leg('WALK', { startName: '환승역', endName: '다음 승차점' }),
      leg('BUS', { routeName: '후속 버스' }),
    )

    expect(findStationAccessComparisonContext(withFollowingLegs).status)
      .toBe('unsupported_structure')
    const result = findStationAccessComparisonContext(withFollowingLegs, {
      allowFollowingLegs: true,
    })

    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.context.busLegIndex).toBe(1)
      expect(result.context.subwayLegIndex).toBe(3)
    }
  })

  it('버스 하차 후 역 접근 WALK가 없으면 시간을 임의 생성하지 않는다', () => {
    const withoutTransferWalk = itinerary()
    withoutTransferWalk.legs = [
      withoutTransferWalk.legs[0],
      withoutTransferWalk.legs[1],
      withoutTransferWalk.legs[3],
    ]

    expect(findStationAccessComparisonContext(withoutTransferWalk)).toEqual({
      status: 'unsupported_structure',
    })
  })
})
