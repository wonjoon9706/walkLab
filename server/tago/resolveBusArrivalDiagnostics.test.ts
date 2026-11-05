import { describe, expect, it, vi } from 'vitest'
import type { BusArrivalRequest, TagoStopCandidate } from '../../src/domain/busArrival.js'
import type { TagoProvider } from './tagoProvider.js'
import { resolveTagoBusArrival } from './resolveBusArrival.js'

const request: BusArrivalRequest = {
  routeName: '지선:2222',
  routeId: 'PROVIDER-2222',

  boardingStop: {
    providerStopId: 'PROVIDER-A',
    name: '성동세무서앞',
    coordinate: { latitude: 37.548, longitude: 127.055 },
  },
  nextStop: {
    providerStopId: 'PROVIDER-B',
    name: '다음정류장',
    coordinate: { latitude: 37.549, longitude: 127.056 },
  },
  alightingStop: {
    providerStopId: 'PROVIDER-C',
    name: '건대입구역사거리·건대병원',
    coordinate: { latitude: 37.54, longitude: 127.07 },
  },
}

function candidate(overrides: Partial<TagoStopCandidate> = {}): TagoStopCandidate {
  return {
    cityCode: '11',
    nodeId: 'SEOUL-A',
    name: '성동세무서앞',
    coordinate: request.boardingStop.coordinate,
    routes: [],
    ...overrides,
  }
}

function provider(stop: TagoStopCandidate): TagoProvider {
  return {
    getCityCodes: vi.fn().mockResolvedValue([{ code: '11', name: '서울특별시' }]),
    getNearbyStops: vi.fn().mockResolvedValue([stop]),
    getRoutesAtStop: vi.fn().mockResolvedValue([]),
    getRouteStops: vi.fn().mockResolvedValue([]),
    getArrivals: vi.fn().mockResolvedValue([]),
  }
}

describe('TAGO 로컬 매칭 진단', () => {
  it('120m 안 후보의 이름 표기가 다르면 노선 조회 전 실패로 구분한다', async () => {
    const fakeProvider = provider(candidate({ name: '성동세무서' }))

    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
      new Date('2026-11-03T00:00:00.000Z'),
      undefined,
      { diagnosticsEnabled: true },
    )

    expect(result.status).toBe('stop_match_failed')
    expect(result.diagnostics).toMatchObject({
      source: 'live',
      lastStage: 'nearby_stops',
      outcomeReason: 'STOP_NAME_MISMATCH',
      nearbyStopCount: 1,
      routeLookupCandidateCount: 0,
      candidates: [{
        name: '성동세무서',
        distanceM: 0,
        nameMatched: false,
        routeNames: [],
      }],
    })
    expect(fakeProvider.getRoutesAtStop).not.toHaveBeenCalled()
  })

  it('같은 이름 후보가 120m 밖이면 거리 실패로 구분한다', async () => {
    const fakeProvider = provider(candidate({
      coordinate: { latitude: 37.55, longitude: 127.055 },
    }))

    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
      new Date(),
      undefined,
      { diagnosticsEnabled: true },
    )

    expect(result.diagnostics).toMatchObject({
      lastStage: 'nearby_stops',
      outcomeReason: 'NO_STOP_WITHIN_120M',
      candidates: [{ nameMatched: true }],
    })
  })

  it('정류장은 맞지만 노선번호가 없으면 경유 노선 단계 실패로 구분한다', async () => {
    const fakeProvider = provider(candidate())
    vi.mocked(fakeProvider.getRoutesAtStop).mockResolvedValue([{
      routeId: 'OTHER', routeName: '3333', nextStopCoordinate: null,
    }])

    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
      new Date(),
      undefined,
      { diagnosticsEnabled: true },
    )

    expect(result.diagnostics).toMatchObject({
      lastStage: 'routes_at_stop',
      outcomeReason: 'ROUTE_NUMBER_MISMATCH',
      candidates: [{ routeNames: ['3333'] }],
    })
    expect(fakeProvider.getRouteStops).not.toHaveBeenCalled()
  })

  it('경유 순서가 누락되면 단순 검색 실패가 아니라 방향 확인 필요로 구분한다', async () => {
    const fakeProvider = provider(candidate())
    vi.mocked(fakeProvider.getRoutesAtStop).mockResolvedValue([{
      routeId: 'TAGO-2222', routeName: '2222', nextStopCoordinate: null,
    }])
    vi.mocked(fakeProvider.getRouteStops).mockResolvedValue([{
      routeId: 'TAGO-2222', nodeId: 'SEOUL-A', name: '성동세무서앞',
      sequence: null, coordinate: request.boardingStop.coordinate,
      upDownCode: '0',
    }])

    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
      new Date(),
      undefined,
      { diagnosticsEnabled: true },
    )

    expect(result.status).toBe('stop_match_review_required')
    expect(result.diagnostics).toMatchObject({
      lastStage: 'direction',
      outcomeReason: 'DIRECTION_REVIEW_REQUIRED',
      candidates: [{
        directionChecks: [{
          status: 'review_required',
          reason: 'MISSING_SEQUENCE',
        }],
      }],
    })
    expect(fakeProvider.getArrivals).not.toHaveBeenCalled()
  })
})
