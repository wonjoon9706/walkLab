import { describe, expect, it } from 'vitest'
import type { TransitItinerary, TransitRouteLeg } from '../../domain/transitRoute'
import type { WalkingRoute } from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import {
  compareLastBusWithDirectWalk,
  findLastBusAlternativeContext,
  lastBusAlternativePolicy,
} from './lastBusAlternativeComparison'

const stationExit = { latitude: 37.540, longitude: 127.060 }
const busStop = { latitude: 37.545, longitude: 127.062 }
const alightingStop = { latitude: 37.548, longitude: 127.064 }
const destination = { latitude: 37.547742, longitude: 127.064236 }

function leg(
  mode: TransitRouteLeg['mode'],
  overrides: Partial<TransitRouteLeg> = {},
): TransitRouteLeg {
  return {
    mode,
    distanceM: mode === 'WALK' ? 200 : 2_000,
    durationSeconds: mode === 'WALK' ? 300 : 183,
    routeName: mode === 'BUS' ? '2222' : mode === 'SUBWAY' ? '7호선' : null,
    routeColor: null,
    routeType: null,
    startName: '시작',
    endName: '끝',
    coordinates: [],
    ...overrides,
  }
}

function itinerary(overrides: Partial<TransitRouteLeg>[] = []): TransitItinerary {
  const legs = [
    leg('WALK', overrides[0]),
    leg('SUBWAY', { endCoordinate: stationExit, ...overrides[1] }),
    leg('WALK', {
      distanceM: 200,
      startName: '건대입구역 접근점',
      endName: '건대입구역사거리·건대병원',
      startCoordinate: stationExit,
      endCoordinate: busStop,
      ...overrides[2],
    }),
    leg('BUS', {
      startCoordinate: busStop,
      endCoordinate: alightingStop,
      ...overrides[3],
    }),
    leg('WALK', {
      distanceM: 256,
      durationSeconds: 266,
      startName: '성동세무서',
      endName: '하이스튜디오',
      startCoordinate: alightingStop,
      endCoordinate: destination,
      ...overrides[4],
    }),
  ]
  return {
    id: 'route',
    totalDurationSeconds: 2_000,
    totalWalkDurationSeconds: 866,
    totalWalkDistanceM: 656,
    totalDistanceM: 10_000,
    transferCount: 2,
    fareKrw: 1_500,
    legs,
  }
}

function speedModel(status: 'ready' | 'insufficient' = 'ready'): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1',
    status,
    estimatedSpeedMps: status === 'ready' ? 2 : null,
    simpleAverageSpeedMps: status === 'ready' ? 2 : null,
    validSessionCount: status === 'ready' ? 5 : 1,
    windowDays: 30,
    trainingPeriodStart: null,
    trainingPeriodEnd: null,
    lastUpdatedAt: null,
    calculatedAt: '2026-11-03T00:00:00.000Z',
    estimatedOneKilometerSeconds: status === 'ready' ? 500 : null,
    decisions: [],
  }
}

function directRoute(distanceM = 1_200): WalkingRoute {
  return {
    distanceM,
    providerDurationSeconds: 900,
    coordinates: [stationExit, destination],
    provider: 'kakao-walking-route',
    requestedAt: '2026-11-03T00:00:00.000Z',
  }
}

function readyContext(route = itinerary()) {
  const result = findLastBusAlternativeContext(
    route,
    destination,
    '하이스튜디오',
  )
  if (result.status !== 'ready') throw new Error(result.status)
  return result.context
}

describe('T2-4A 마지막 버스 생략 비교', () => {
  it('WALK → SUBWAY → WALK → BUS → WALK 구조와 같은 양 끝점을 확인한다', () => {
    expect(findLastBusAlternativeContext(
      itinerary(), destination, '하이스튜디오',
    )).toMatchObject({
      status: 'ready',
      context: { startCoordinate: stationExit, destinationCoordinate: destination },
    })
    expect(findLastBusAlternativeContext({
      ...itinerary(), legs: [leg('WALK'), leg('BUS')],
    }, destination, '하이스튜디오').status).toBe('unsupported_structure')
  })

  it('구간 연결 좌표나 최종 목적지가 다르면 비교하지 않는다', () => {
    expect(findLastBusAlternativeContext(itinerary([
      {}, {}, {}, { startCoordinate: { latitude: 37.6, longitude: 127.1 } }, {},
    ]), destination, '하이스튜디오').status).toBe('coordinate_mismatch')
    expect(findLastBusAlternativeContext(
      itinerary(), { latitude: 37.6, longitude: 127.1 }, '다른 목적지',
    ).status).toBe('coordinate_mismatch')
  })

  it('TMAP 대기시간 없이 G7 보행과 버스 구간만 기본 이동시간으로 합산한다', () => {
    const route = itinerary()
    const result = compareLastBusWithDirectWalk(
      route, readyContext(route), directRoute(), speedModel(),
    )
    expect(result.busAccessWalkDurationSeconds).toBe(100)
    expect(result.busRideDurationSeconds).toBe(183)
    expect(result.finalWalkDurationSeconds).toBe(128)
    expect(result.busBaseDurationSeconds).toBe(411)
    expect(result.busWaitSeconds).toBeNull()
  })

  it('대기 미확인 시 계산된 손익분기 대기시간만 안내한다', () => {
    const route = itinerary()
    const result = compareLastBusWithDirectWalk(
      route, readyContext(route), directRoute(), speedModel(),
    )
    expect(result.directWalkDurationSeconds).toBe(600)
    expect(result.breakEvenWaitSeconds).toBe(189)
    expect(result.outcome).toBe('bus_faster_if_wait_below_threshold')
  })

  it('직접 도보가 버스 기본 이동시간보다 짧으면 대기 0초에도 직접 도보가 빠르다고 분류한다', () => {
    const route = itinerary()
    const result = compareLastBusWithDirectWalk(
      route, readyContext(route), directRoute(600), speedModel(),
    )
    expect(result.outcome).toBe('direct_walk_faster_even_without_wait')
    expect(result.breakEvenWaitSeconds).toBeLessThan(0)
  })

  it('현재 시점 버스 정보는 미래 환승 대기시간으로 적용하지 않는다', () => {
    const route = itinerary()
    const result = compareLastBusWithDirectWalk(
      route,
      readyContext(route),
      directRoute(),
      speedModel(),
      { waitSeconds: 30, timing: 'current_time_only' },
    )
    expect(result.busWaitSeconds).toBeNull()
    expect(result.outcome).toBe('bus_faster_if_wait_below_threshold')
  })

  it('환승 시점에 검증된 대기시간만 실제 우열 계산에 적용한다', () => {
    const route = itinerary()
    const busFast = compareLastBusWithDirectWalk(
      route, readyContext(route), directRoute(), speedModel(),
      { waitSeconds: 0, timing: 'transfer_time_verified' },
    )
    const directFast = compareLastBusWithDirectWalk(
      route, readyContext(route), directRoute(), speedModel(),
      { waitSeconds: 400, timing: 'transfer_time_verified' },
    )
    expect(busFast.outcome).toBe('bus_faster')
    expect(directFast.outcome).toBe('direct_walk_faster')
  })

  it('G7 미학습 사용자는 기존 기본속도 fallback을 유지한다', () => {
    const route = itinerary()
    const result = compareLastBusWithDirectWalk(
      route, readyContext(route), directRoute(), speedModel('insufficient'),
    )
    expect(result.directWalkSpeedProfile.source).toBe('default')
  })

  it('G8 시작·종료 스냅 오차가 30m를 넘으면 참고용으로만 유지한다', () => {
    const route = itinerary()
    const snapped = directRoute()
    snapped.coordinates = [
      stationExit,
      { latitude: 37.5482, longitude: 127.0648 },
    ]
    const result = compareLastBusWithDirectWalk(
      route, readyContext(route), snapped, speedModel(),
    )
    expect(result.directRouteValidation).toBe('review_only')
    expect(result.outcome).toBe('review_required')
  })

  it('좌표 및 비슷함 기준을 기존 T2-4A와 같은 값으로 고정한다', () => {
    expect(lastBusAlternativePolicy).toEqual({
      endpointMaximumGapM: 30,
      similarMaximumDifferenceSeconds: 120,
    })
  })
})
