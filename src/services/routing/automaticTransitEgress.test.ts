import { describe, expect, it, vi } from 'vitest'
import type { SeoulBusProvider } from '../../../server/tago/seoulBusProvider'
import type { SeoulRouteStopArrival } from '../../domain/seoulBus'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { PlaceSearchResult, WalkingRoute } from '../../domain/walkingRoute'
import { WalkingRouteError } from '../../domain/walkingRoute'
import { resolveAutomaticTransitEgress } from './automaticTransitEgress'

const stepEnd = { latitude: 37.001, longitude: 127.001 }
const verifiedStop = { latitude: 37.0011, longitude: 127.0011 }
const destination = { latitude: 37.002, longitude: 127.002 }

function route(mode: 'BUS' | 'SUBWAY'): KakaoTransitRoute {
  return {
    id: `egress-${mode.toLowerCase()}`,
    type: mode,
    totalDistanceM: 4_000,
    totalDurationSeconds: 1_700,
    transferCount: 0,
    fare: null,
    steps: [
      {
        index: 0,
        mode,
        guidance: 'synthetic',
        distanceM: 3_800,
        durationSeconds: 1_500,
        stops: mode === 'BUS'
          ? [
              { index: 0, name: '첫정류장' },
              { index: 1, name: '중간정류장' },
              { index: 2, name: '마지막정류장' },
            ]
          : [
              { index: 0, name: '출발역' },
              { index: 1, name: '도착역' },
            ],
        vehicles: [{ index: 0, name: mode === 'BUS' ? '테스트17' : '7호선', type: null }],
        coordinates: [
          { latitude: 37, longitude: 127 },
          stepEnd,
        ],
      },
      {
        index: 1,
        mode: 'WALKING',
        guidance: 'provider walk evidence only',
        distanceM: 200,
        durationSeconds: 200,
        stops: [],
        vehicles: [],
        coordinates: [],
      },
    ],
  }
}

function routeStop(
  routeId: string,
  stopId: string,
  name: string,
  sequence: number,
): SeoulRouteStopArrival {
  return {
    routeId,
    routeName: '테스트17',
    routeType: null,
    stopId,
    arsId: null,
    stopName: name,
    sequence,
    estimates: [],
  }
}

function provider(duplicateValid = false): SeoulBusProvider {
  return {
    getNearbyStops: vi.fn(async () => [
      {
        stopId: 'verified-stop',
        arsId: '10001',
        name: '마지막정류장',
        coordinate: verifiedStop,
      },
      {
        stopId: 'opposite-stop',
        arsId: '10002',
        name: '마지막정류장',
        coordinate: { latitude: 37.00105, longitude: 127.00105 },
      },
    ]),
    getRoutesAtStop: vi.fn(async (arsId: string) => [{
      routeId: arsId === '10001' ? 'verified-route' : 'opposite-route',
      routeName: '테스트17',
      routeType: null,
    }]),
    getRouteArrivals: vi.fn(async (routeId: string) => {
      if (routeId === 'verified-route' || duplicateValid) {
        const prefix = routeId === 'verified-route' ? 'verified' : 'opposite'
        return [
          routeStop(routeId, `${prefix}-first`, '첫정류장', 1),
          routeStop(routeId, `${prefix}-middle`, '중간정류장', 2),
          routeStop(routeId, `${prefix}-stop`, '마지막정류장', 3),
        ]
      }
      return [
        routeStop(routeId, 'opposite-first', '반대방향', 1),
        routeStop(routeId, 'opposite-stop', '마지막정류장', 2),
      ]
    }),
  }
}

function walkingRoute(
  start = verifiedStop,
  end = destination,
  distanceM = 250,
): WalkingRoute {
  return {
    distanceM,
    providerDurationSeconds: 220,
    coordinates: [start, end],
    provider: 'kakao-walking-route',
    requestedAt: '2026-01-01T00:00:00.000Z',
  }
}

function exitPlace(
  id: string,
  name: string,
  coordinate = verifiedStop,
): PlaceSearchResult {
  return {
    id,
    name,
    address: '비식별 테스트 주소',
    roadAddress: null,
    categoryName: '교통,수송 > 지하철,전철 > 7호선 > 지하철출구',
    categoryGroupCode: 'SW8',
    coordinate,
  }
}

const destinationInput = {
  name: '사용자 목적지',
  coordinate: destination,
  source: 'user_selected_place' as const,
  providerPlaceId: 'destination-id',
}

const common = {
  destination: destinationInput,
  speed: {
    kind: 'reference_only' as const,
    speedMps: 1.5,
    label: '테스트 참고값',
  },
  signal: new AbortController().signal,
}

function dependencies(options?: {
  busProvider?: SeoulBusProvider
  places?: PlaceSearchResult[]
  walking?: (request: { start: typeof verifiedStop; destination: typeof destination }) => Promise<WalkingRoute>
}) {
  return {
    seoulBusProvider: options?.busProvider ?? provider(),
    searchPlaces: vi.fn(async () => options?.places ?? []),
    getWalkingRoute: vi.fn(options?.walking ?? (async ({ start, destination: end }) =>
      walkingRoute(start, end))),
  }
}

describe('resolveAutomaticTransitEgress', () => {
  it('동일 이름 반대편을 제외하고 검증된 버스 하차점부터 목적지까지 연결한다', async () => {
    const deps = dependencies()
    const result = await resolveAutomaticTransitEgress({
      ...common,
      route: route('BUS'),
    }, deps)

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.busCandidates).toHaveLength(1)
    expect(result.egressWalk.alightingPoint).toMatchObject({
      mode: 'BUS',
      providerStopId: 'verified-stop',
      providerRouteId: 'verified-route',
    })
    expect(deps.getWalkingRoute).toHaveBeenCalledWith({
      start: verifiedStop,
      destination,
    })
    expect(result.egressWalk.walkingRoute.distanceM).toBe(250)
    expect(result.egressWalk.personalizedTotalEtaSeconds).toBeNull()
  })

  it('유효한 동일 이름 하차 정류장이 둘이면 자동 선택하지 않는다', async () => {
    const result = await resolveAutomaticTransitEgress({
      ...common,
      route: route('BUS'),
    }, dependencies({ busProvider: provider(true) }))

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('MULTIPLE_VERIFIED_BUS_STOPS')
    expect(result.busCandidates).toHaveLength(2)
  })

  it('단일 지하철 출구부터 목적지까지 G8 경로를 연결한다', async () => {
    const result = await resolveAutomaticTransitEgress({
      ...common,
      route: route('SUBWAY'),
    }, dependencies({
      places: [exitPlace('exit-1', '도착역 7호선 1번출구')],
    }))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.egressWalk.alightingPoint).toMatchObject({
      mode: 'SUBWAY',
      providerPlaceId: 'exit-1',
      lineAccessStatus: 'unverified',
      closureStatus: 'unknown',
    })
    expect(result.egressWalk.internalStationEgress.status).toBe('unknown')
  })

  it('폐쇄 출구를 제외하고 남은 출구만 사용한다', async () => {
    const result = await resolveAutomaticTransitEgress({
      ...common,
      route: route('SUBWAY'),
    }, dependencies({
      places: [
        exitPlace('closed', '도착역 7호선 1번출구(임시폐쇄)'),
        exitPlace('usable', '도착역 7호선 2번출구'),
      ],
    }))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.egressWalk.alightingPoint).toMatchObject({ providerPlaceId: 'usable' })
    expect(result.subwayCandidates.find(
      (candidate) => candidate.place.id === 'closed',
    )?.closureStatus).toBe('confirmed_closed')
  })

  it('복수 출구는 각 G8 거리와 스냅 오차를 보존하고 확정하지 않는다', async () => {
    const otherExit = { latitude: 37.0012, longitude: 127.0012 }
    const result = await resolveAutomaticTransitEgress({
      ...common,
      route: route('SUBWAY'),
    }, dependencies({
      places: [
        exitPlace('exit-1', '도착역 7호선 1번출구'),
        exitPlace('exit-2', '도착역 7호선 2번출구', otherExit),
      ],
      walking: async ({ start, destination: end }) =>
        walkingRoute(start, end, start === otherExit ? 300 : 250),
    }))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.egressWalk.alightingPoint).toMatchObject({
      providerPlaceId: 'exit-1',
      selectionConfidence: 'provisional',
      internalStationTimeIncluded: false,
    })
    expect(result.subwayCandidates.map((candidate) => candidate.walkingDistanceM))
      .toEqual([250, 300])
    expect(result.subwayCandidates.every(
      (candidate) => candidate.startGapM === 0 && candidate.destinationGapM === 0,
    )).toBe(true)
  })

  it('카카오 마지막 좌표 대신 실제 출구 좌표를 G8 시작점으로 사용한다', async () => {
    const deps = dependencies({
      places: [exitPlace('exit-1', '도착역 7호선 1번출구')],
    })
    await resolveAutomaticTransitEgress({
      ...common,
      route: route('SUBWAY'),
    }, deps)

    expect(stepEnd).not.toEqual(verifiedStop)
    expect(deps.getWalkingRoute).toHaveBeenCalledWith({
      start: verifiedStop,
      destination,
    })
  })

  it('G8 실패를 명시하고 하차 경로를 생성하지 않는다', async () => {
    const result = await resolveAutomaticTransitEgress({
      ...common,
      route: route('BUS'),
    }, dependencies({
      walking: async () => {
        throw new WalkingRouteError('ROUTE_NOT_FOUND', 'test')
      },
    }))

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('WALKING_ROUTE_FAILED')
    expect(result.busCandidates[0]).toMatchObject({
      walkingRouteStatus: 'failed',
      walkingErrorCode: 'ROUTE_NOT_FOUND',
    })
  })

  it('화양사거리 실측처럼 G8 양 끝 스냅이 57.2m/37.7m이면 참고 경로를 보존한다', async () => {
    const snappedStart = {
      latitude: verifiedStop.latitude + 57.2 / 111_195,
      longitude: verifiedStop.longitude,
    }
    const snappedEnd = {
      latitude: destination.latitude - 37.7 / 111_195,
      longitude: destination.longitude,
    }
    const result = await resolveAutomaticTransitEgress({
      ...common,
      route: route('BUS'),
    }, dependencies({
      walking: async () => walkingRoute(snappedStart, snappedEnd, 245),
    }))

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('EGRESS_WALK_REVIEW_REQUIRED')
    expect(result.detailReason).toBe('WALKING_ENDPOINT_MISMATCH')
    expect(result.busCandidates[0].startGapM).toBeCloseTo(57.2, 0)
    expect(result.busCandidates[0].destinationGapM).toBeCloseTo(37.7, 0)
    expect(result.busCandidates[0].walkingDistanceM).toBe(245)
    expect(result.busCandidates[0].walkingRoute?.coordinates).toHaveLength(2)
  })
})
