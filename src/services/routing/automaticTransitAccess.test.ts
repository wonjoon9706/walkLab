import { describe, expect, it, vi } from 'vitest'
import type { SeoulBusProvider } from '../../../api/tago/seoulBusProvider'
import type { SeoulRouteStopArrival } from '../../domain/seoulBus'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { PlaceSearchResult, WalkingRoute } from '../../domain/walkingRoute'
import { WalkingRouteError } from '../../domain/walkingRoute'
import { resolveAutomaticTransitAccess } from './automaticTransitAccess'

const origin = { latitude: 37, longitude: 127 }
const stepAnchor = { latitude: 37.0001, longitude: 127.0001 }
const targetCoordinate = { latitude: 37.0002, longitude: 127.0002 }

function transitRoute(mode: 'BUS' | 'SUBWAY', vehicles?: string[]): KakaoTransitRoute {
  const vehicleNames = vehicles ?? [mode === 'BUS' ? '동작17' : '7호선']
  return {
    id: `synthetic-${mode.toLowerCase()}`,
    type: mode,
    totalDistanceM: 5_000,
    totalDurationSeconds: 1_800,
    transferCount: 0,
    fare: null,
    steps: [{
      index: 0,
      mode,
      guidance: 'synthetic',
      distanceM: 4_000,
      durationSeconds: 1_200,
      stops: mode === 'BUS'
        ? [
            { index: 0, name: '극동상가' },
            { index: 1, name: '중간정류장' },
            { index: 2, name: '이수역' },
          ]
        : [
            { index: 0, name: '이수' },
            { index: 1, name: '내방' },
          ],
      vehicles: vehicleNames.map((name, index) => ({ index, name, type: null })),
      coordinates: [stepAnchor, { latitude: 37.01, longitude: 127.01 }],
    }],
  }
}

function routeStop(
  routeId: string,
  stopId: string,
  stopName: string,
  sequence: number,
): SeoulRouteStopArrival {
  return {
    routeId,
    routeName: '동작17',
    routeType: null,
    stopId,
    arsId: null,
    stopName,
    sequence,
    estimates: [],
  }
}

function busProvider(options?: { duplicateValid?: boolean }): SeoulBusProvider {
  const stops = [
    { stopId: 'correct-stop', arsId: '10001', name: '극동상가', coordinate: targetCoordinate },
    { stopId: 'opposite-stop', arsId: '10002', name: '극동상가', coordinate: { latitude: 37.00015, longitude: 127.00015 } },
  ]
  return {
    getNearbyStops: vi.fn(async () => stops),
    getRoutesAtStop: vi.fn(async (arsId: string) => [{
      routeId: arsId === '10001' ? 'correct-route' : 'opposite-route',
      routeName: '동작17',
      routeType: null,
    }]),
    getRouteArrivals: vi.fn(async (routeId: string) => {
      if (routeId === 'correct-route' || options?.duplicateValid) {
        const prefix = routeId === 'correct-route' ? 'correct' : 'opposite'
        return [
          routeStop(routeId, `${prefix}-stop`, '극동상가', 1),
          routeStop(routeId, `${prefix}-middle`, '중간정류장', 2),
          routeStop(routeId, `${prefix}-end`, '이수역', 3),
        ]
      }
      return [
        routeStop(routeId, 'opposite-stop', '극동상가', 5),
        routeStop(routeId, 'opposite-next', '반대방향', 6),
      ]
    }),
  }
}

function walkingRoute(destination = targetCoordinate, distanceM = 100): WalkingRoute {
  return {
    distanceM,
    providerDurationSeconds: 90,
    coordinates: [origin, destination],
    provider: 'kakao-walking-route',
    requestedAt: '2026-01-01T00:00:00.000Z',
  }
}

function place(
  id: string,
  name: string,
  coordinate = targetCoordinate,
  categoryName = '교통,수송 > 지하철,전철 > 7호선 > 지하철출구',
): PlaceSearchResult {
  return {
    id,
    name,
    address: '비식별 테스트 주소',
    roadAddress: null,
    categoryName,
    categoryGroupCode: 'SW8',
    coordinate,
  }
}

function dependencies(overrides?: {
  provider?: SeoulBusProvider
  places?: PlaceSearchResult[]
  walking?: (request: { destination: typeof targetCoordinate }) => Promise<WalkingRoute>
}) {
  return {
    seoulBusProvider: overrides?.provider ?? busProvider(),
    searchPlaces: vi.fn(async () => overrides?.places ?? []),
    getWalkingRoute: vi.fn(overrides?.walking ?? (async ({ destination }) =>
      walkingRoute(destination))),
  }
}

const commonInput = {
  origin: {
    coordinate: origin,
    verification: 'representative_coordinate' as const,
    note: '실제 출입구 미확정',
  },
  speed: {
    kind: 'reference_only' as const,
    speedMps: 5.7 / 3.6,
    label: '테스트 참고값',
  },
  signal: new AbortController().signal,
}

describe('resolveAutomaticTransitAccess', () => {
  it('동일 이름 반대편을 제외하고 노선 경유 순서가 유일한 버스 정류장을 결정한다', async () => {
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('BUS'),
    }, dependencies())

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.busCandidates).toHaveLength(1)
    expect(result.accessWalk.target).toMatchObject({
      mode: 'BUS',
      providerStopId: 'correct-stop',
      providerRouteId: 'correct-route',
      directionVerification: 'route_stop_order',
    })
    expect(result.accessWalk.walkingRoute.distanceM).toBe(100)
    expect(result.accessWalk.speedBasis.kind).toBe('reference_only')
  })

  it('동작17 순환 경로의 뒤쪽 이수역 중복과 무관하게 인접 경유 순서로 112동을 검증한다', async () => {
    const dongjakRoute = transitRoute('BUS', ['동작17'])
    dongjakRoute.steps[0].stops = [
      { index: 0, name: '극동아파트112동' },
      { index: 1, name: '삼일초등학교앞' },
      { index: 2, name: '동작삼일수영장' },
      { index: 3, name: '남성초등학교.사당청소년센터' },
      { index: 4, name: '삼거리우편물취급소' },
      { index: 5, name: '사당1동주민센터입구' },
      { index: 6, name: '이수역' },
    ]
    const providerFor112: SeoulBusProvider = {
      getNearbyStops: vi.fn(async () => [{
        stopId: 'stop-112', arsId: '20532', name: '극동아파트112동',
        coordinate: targetCoordinate,
      }]),
      getRoutesAtStop: vi.fn(async () => [{
        routeId: 'dongjak-17', routeName: '동작17', routeType: '마을',
      }]),
      getRouteArrivals: vi.fn(async () => [
        routeStop('dongjak-17', 'stop-112', '극동아파트112동', 3),
        routeStop('dongjak-17', 'stop-4', '삼일초등학교앞', 4),
        routeStop('dongjak-17', 'stop-5', '동작삼일수영장', 5),
        routeStop('dongjak-17', 'stop-6', '남성초등학교.사당청소년센터', 6),
        routeStop('dongjak-17', 'stop-7', '삼거리우편물취급소', 7),
        routeStop('dongjak-17', 'stop-8', '사당1동주민센터입구', 8),
        routeStop('dongjak-17', 'stop-9', '이수역', 9),
        routeStop('dongjak-17', 'stop-17', '이수역', 17),
      ]),
    }

    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: dongjakRoute,
    }, dependencies({ provider: providerFor112 }))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.accessWalk.target).toMatchObject({
      providerStopId: 'stop-112',
      arsId: '20532',
      providerRouteId: 'dongjak-17',
    })
    expect(result.busDiagnostics).toMatchObject({
      nearbyStopCount: 1,
      expectedStopName: '극동아파트112동',
      candidates: [{
        outcome: 'VERIFIED',
        routeMatches: [{ directionVerified: true, reason: 'VERIFIED' }],
      }],
    })
  })

  it('중간 경유 증거 없이 중복 이수역만 있는 경우 방향을 임의 확정하지 않는다', async () => {
    const ambiguousRoute = transitRoute('BUS', ['동작17'])
    ambiguousRoute.steps[0].stops = [
      { index: 0, name: '극동아파트112동' },
      { index: 1, name: '이수역' },
    ]
    const ambiguousProvider: SeoulBusProvider = {
      getNearbyStops: vi.fn(async () => [{
        stopId: 'stop-112', arsId: '20532', name: '극동아파트112동',
        coordinate: targetCoordinate,
      }]),
      getRoutesAtStop: vi.fn(async () => [{
        routeId: 'dongjak-17', routeName: '동작17', routeType: '마을',
      }]),
      getRouteArrivals: vi.fn(async () => [
        routeStop('dongjak-17', 'stop-112', '극동아파트112동', 3),
        routeStop('dongjak-17', 'stop-9', '이수역', 9),
        routeStop('dongjak-17', 'stop-17', '이수역', 17),
      ]),
    }

    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: ambiguousRoute,
    }, dependencies({ provider: ambiguousProvider }))

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('NO_VERIFIED_BUS_STOP')
    expect(result.busDiagnostics?.candidates[0]).toMatchObject({
      outcome: 'DIRECTION_MISMATCH',
      routeMatches: [{ reason: 'STOP_ORDER_MISMATCH' }],
    })
  })

  it('유효한 버스 정류장이 둘이면 임의 선택하지 않는다', async () => {
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('BUS'),
    }, dependencies({ provider: busProvider({ duplicateValid: true }) }))

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('MULTIPLE_VERIFIED_BUS_STOPS')
    expect(result.busCandidates).toHaveLength(2)
  })

  it('카카오 복수 차량 후보를 검증하되 하나로 확정하지 않는다', async () => {
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('BUS', ['동작17', '동작17-1']),
    }, dependencies())

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('MULTIPLE_VEHICLE_OPTIONS')
    expect(result.busCandidates).toHaveLength(1)
  })

  it('역명·노선·출구 카테고리가 맞는 단일 출입구에 G8 경로를 연결한다', async () => {
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('SUBWAY'),
    }, dependencies({
      places: [place('exit-10', '이수역 7호선 10번출구')],
    }))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.accessWalk.target).toMatchObject({
      mode: 'SUBWAY',
      providerPlaceId: 'exit-10',
      closureStatus: 'unknown',
      lineAccessStatus: 'unverified',
    })
    expect(result.accessWalk.internalStationAccess.status).toBe('unknown')
    expect(result.subwayCandidates[0].startGapM).toBe(0)
    expect(result.subwayCandidates[0].destinationGapM).toBe(0)
  })

  it('출입구는 검증됐지만 G8 시작점 스냅이 30m를 넘으면 원인을 구분한다', async () => {
    const snappedWalkingStart = {
      latitude: origin.latitude + 0.000298,
      longitude: origin.longitude,
    }
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('SUBWAY'),
    }, dependencies({
      places: [place('exit-10', '이수역 7호선 10번출구')],
      walking: async ({ destination }) => ({
        ...walkingRoute(destination),
        coordinates: [snappedWalkingStart, destination],
      }),
    }))

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('ACCESS_WALK_START_SNAP_MISMATCH')
    expect(result.detailReason).toBe('WALKING_ENDPOINT_MISMATCH')
    expect(result.subwayCandidates[0]).toMatchObject({
      stationNameMatches: true,
      lineMatches: true,
      entranceCategoryMatches: true,
      walkingRouteStatus: 'available',
      destinationGapM: 0,
    })
    expect(result.subwayCandidates[0].startGapM).toBeGreaterThan(33)
    expect(result.subwayCandidates[0].startGapM).toBeLessThan(34)
  })

  it('폐쇄가 표시된 출입구를 제외한다', async () => {
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('SUBWAY'),
    }, dependencies({
      places: [
        place('closed-exit', '이수역 7호선 9번출구(임시폐쇄)'),
        place('open-unknown-exit', '이수역 7호선 10번출구'),
      ],
    }))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.accessWalk.target).toMatchObject({ providerPlaceId: 'open-unknown-exit' })
    expect(result.subwayCandidates.find(
      (candidate) => candidate.place.id === 'closed-exit',
    )?.closureStatus).toBe('confirmed_closed')
  })

  it('유효한 출입구가 여러 개면 G8 거리와 스냅 오차를 제공하고 검토 상태로 둔다', async () => {
    const secondCoordinate = { latitude: 37.0003, longitude: 127.0003 }
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('SUBWAY'),
    }, dependencies({
      places: [
        place('exit-10', '이수역 7호선 10번출구'),
        place('exit-11', '이수역 7호선 11번출구', secondCoordinate),
      ],
      walking: async ({ destination }) => walkingRoute(
        destination,
        destination === secondCoordinate ? 120 : 100,
      ),
    }))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.accessWalk.target).toMatchObject({
      providerPlaceId: 'exit-10',
      selectionConfidence: 'provisional',
      internalStationTimeIncluded: false,
    })
    expect(result.subwayCandidates.map((candidate) => candidate.walkingDistanceM))
      .toEqual([100, 120])
    expect(result.subwayCandidates.map((candidate) => candidate.selectionRank))
      .toEqual([1, 2])
  })

  it('출입구 카테고리·노선이 불확실하면 G8을 호출하지 않는다', async () => {
    const deps = dependencies({
      places: [place(
        'station-center',
        '이수역',
        targetCoordinate,
        '교통,수송 > 지하철,전철 > 4호선',
      )],
    })
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('SUBWAY'),
    }, deps)

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('NO_VERIFIED_SUBWAY_ENTRANCE')
    expect(deps.getWalkingRoute).not.toHaveBeenCalled()
  })

  it('G8 조회 실패를 승차 지점 확정으로 숨기지 않는다', async () => {
    const result = await resolveAutomaticTransitAccess({
      ...commonInput,
      route: transitRoute('SUBWAY'),
    }, dependencies({
      places: [place('exit-10', '이수역 7호선 10번출구')],
      walking: async () => {
        throw new WalkingRouteError('ROUTE_NOT_FOUND', 'test')
      },
    }))

    expect(result.status).toBe('review_required')
    if (result.status !== 'review_required') return
    expect(result.reason).toBe('WALKING_ROUTE_FAILED')
    expect(result.subwayCandidates[0]).toMatchObject({
      walkingRouteStatus: 'failed',
      walkingErrorCode: 'ROUTE_NOT_FOUND',
    })
  })
})
