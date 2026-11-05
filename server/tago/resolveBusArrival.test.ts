import { describe, expect, it, vi } from 'vitest'
import type { BusArrivalRequest, TagoStopCandidate } from '../../src/domain/busArrival.js'
import type { TagoProvider } from './tagoProvider.js'
import { resolveTagoBusArrival } from './resolveBusArrival.js'

const request: BusArrivalRequest = {
  routeName: '직행좌석:7800',
  routeId: 'PROVIDER-7800',

  boardingStop: {
    providerStopId: 'PROVIDER-A',
    name: '사당역9번출구앞',
    coordinate: { latitude: 37.478, longitude: 126.982 },
  },
  nextStop: {
    providerStopId: 'PROVIDER-B',
    name: '남태령역',
    coordinate: { latitude: 37.468, longitude: 126.982 },
  },
  alightingStop: {
    providerStopId: 'PROVIDER-C',
    name: '의왕톨게이트',
    coordinate: { latitude: 37.45, longitude: 126.982 },
  },
}

function stop(cityCode = '12'): TagoStopCandidate {
  return {
    cityCode,
    nodeId: 'TAGO-A',
    name: '사당역 9번 출구 앞 정류장',
    coordinate: { latitude: 37.47801, longitude: 126.982 },
    routes: [],
  }
}

function provider(nextStopLatitude: number | null = 37.468): TagoProvider {
  return {
    getCityCodes: vi.fn().mockResolvedValue([{ code: '12', name: '서울' }]),
    getNearbyStops: vi.fn().mockResolvedValue([stop()]),
    getRoutesAtStop: vi.fn().mockResolvedValue([{
      routeId: 'TAGO-7800',
      routeName: '7800',
      nextStopCoordinate: nextStopLatitude === null
        ? null
        : { latitude: nextStopLatitude, longitude: 126.982 },
    }]),
    getRouteStops: vi.fn().mockResolvedValue([
      {
        routeId: 'TAGO-7800',
        nodeId: 'TAGO-A',
        name: '사당역9번출구앞',
        sequence: 1,
        coordinate: { latitude: 37.47801, longitude: 126.982 },
        upDownCode: '0',
      },
      {
        routeId: 'TAGO-7800',
        nodeId: 'TAGO-B',
        name: '남태령역',
        sequence: 2,
        coordinate: nextStopLatitude === null
          ? null
          : { latitude: nextStopLatitude, longitude: 126.982 },
        upDownCode: '0',
      },
      {
        routeId: 'TAGO-7800',
        nodeId: 'TAGO-C',
        name: '의왕톨게이트',
        sequence: 3,
        coordinate: { latitude: 37.45, longitude: 126.982 },
        upDownCode: '0',
      },
    ]),
    getArrivals: vi.fn().mockResolvedValue([{
      nodeId: 'TAGO-A',
      nodeName: '사당역9번출구앞',
      routeId: 'TAGO-7800',
      routeName: '7800',
      routeType: '직행좌석',
      arrivalSeconds: 360,
      remainingStops: 3,
    }]),
  }
}

describe('TAGO 버스 도착정보 조합', () => {
  it('정류장·노선·방향이 검증되면 같은 TAGO 노선 ID의 도착정보를 반환한다', async () => {
    const result = await resolveTagoBusArrival(
      request,
      provider(),
      new AbortController().signal,
      new Date('2026-11-03T00:00:00.000Z'),
    )

    expect(result).toEqual({
      routeName: '직행좌석 7800',
      stopName: '사당역 9번 출구 앞 정류장',
      stopId: 'TAGO-A',
      arrivalSeconds: 360,
      remainingStops: 3,
      fetchedAt: '2026-11-03T00:00:00.000Z',
      provider: 'tago',
      dataMode: 'live',
      status: 'available',
      walkingTimeToStopSeconds: null,
    })
  })

  it('승인 API에서 다음 정류장 근거가 없으면 도착정보를 호출하지 않는다', async () => {
    const fakeProvider = provider(null)
    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
    )

    expect(result.status).toBe('stop_match_review_required')
    expect(fakeProvider.getArrivals).not.toHaveBeenCalled()
  })

  it('검증된 정류장에 해당 노선 도착정보가 없으면 no_service를 반환한다', async () => {
    const fakeProvider = provider()
    vi.mocked(fakeProvider.getArrivals).mockResolvedValue([])

    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
    )

    expect(result).toMatchObject({ status: 'no_service', stopId: 'TAGO-A' })
  })

  it('공식 도시코드 목록에 없는 후보는 미지원 지역으로 구분한다', async () => {
    const fakeProvider = provider()
    vi.mocked(fakeProvider.getNearbyStops).mockResolvedValue([stop('999')])

    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
    )

    expect(result.status).toBe('unsupported_region')
    expect(fakeProvider.getRoutesAtStop).not.toHaveBeenCalled()
  })

  it('좌표·이름이 일치하지 않으면 노선이나 도착정보를 조회하지 않는다', async () => {
    const fakeProvider = provider()
    vi.mocked(fakeProvider.getNearbyStops).mockResolvedValue([{
      ...stop(),
      name: '다른 정류장',
    }])

    const result = await resolveTagoBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
    )

    expect(result.status).toBe('stop_match_failed')
    expect(fakeProvider.getRoutesAtStop).not.toHaveBeenCalled()
  })
})
