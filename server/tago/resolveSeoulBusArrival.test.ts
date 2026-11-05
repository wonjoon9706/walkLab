import { describe, expect, it, vi } from 'vitest'
import type { BusArrivalRequest } from '../../src/domain/busArrival.js'
import type { SeoulRouteStopArrival } from '../../src/domain/seoulBus.js'
import type { SeoulBusProvider } from './seoulBusProvider.js'
import { resolveSeoulBusArrival } from './resolveSeoulBusArrival.js'

const request: BusArrivalRequest = {
  routeName: '지선:2222',
  routeId: 'PROVIDER-2222',

  boardingStop: {
    providerStopId: 'PROVIDER-A',
    name: '우리은행화양동지점',
    coordinate: { latitude: 37.548142, longitude: 127.066142 },
  },
  nextStop: {
    providerStopId: 'PROVIDER-B',
    name: '다음정류장',
    coordinate: { latitude: 37.547, longitude: 127.067 },
  },
  alightingStop: {
    providerStopId: 'PROVIDER-C',
    name: '건대입구역사거리·건대병원',
    coordinate: { latitude: 37.54, longitude: 127.07 },
  },
}

function routeStops(
  boardingSequence = 20,
  alightingSequence = 40,
): SeoulRouteStopArrival[] {
  return Array.from({ length: 62 }, (_, index) => {
    const sequence = index + 1
    const isBoarding = sequence === boardingSequence
    const isAlighting = sequence === alightingSequence
    return {
      routeId: '100100199',
      routeName: '2222',
      routeType: '3',
      stopId: isBoarding
        ? '103000189'
        : isAlighting
          ? '104000001'
          : `STOP-${sequence}`,
      arsId: isBoarding ? '04293' : null,
      stopName: isBoarding
        ? '우리은행화양동지점'
        : isAlighting
          ? '건대입구역사거리.건대병원'
          : `정류장${sequence}`,
      sequence,
      estimates: isBoarding
        ? [
            { order: 1, arrivalSeconds: 180, remainingStops: 3, message: '3분 후' },
            { order: 2, arrivalSeconds: 540, remainingStops: 8, message: '9분 후' },
          ]
        : [],
    }
  })
}

function provider(stops = routeStops()): SeoulBusProvider {
  return {
    getNearbyStops: vi.fn()
      .mockResolvedValueOnce([{
        stopId: '103000189',
        arsId: '04293',
        name: '우리은행화양동지점',
        coordinate: request.boardingStop.coordinate,
      }])
      .mockResolvedValueOnce([{
        stopId: '104000001',
        arsId: '05200',
        name: '건대입구역사거리.건대병원',
        coordinate: request.alightingStop.coordinate,
      }]),
    getRoutesAtStop: vi.fn().mockResolvedValue([{
      routeId: '100100199', routeName: '2222', routeType: '3',
    }]),
    getRouteArrivals: vi.fn().mockResolvedValue(stops),
  }
}

describe('서울시 버스 도착정보 매칭', () => {
  it('2222번 62개 경유 순서와 승하차 위치를 검증하고 두 버스를 반환한다', async () => {
    const result = await resolveSeoulBusArrival(
      request,
      provider(),
      new AbortController().signal,
      new Date('2026-11-03T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      handled: true,
      result: {
        status: 'available',
        provider: 'seoul',
        stopId: '103000189',
        stopName: '우리은행화양동지점',
        arrivalSeconds: 180,
        remainingStops: 3,
        upcomingArrivals: [
          { order: 1, arrivalSeconds: 180, remainingStops: 3 },
          { order: 2, arrivalSeconds: 540, remainingStops: 8 },
        ],
      },
    })
  })

  it('하차 정류장이 승차 정류장보다 앞이면 반대 방향으로 자동 매칭하지 않는다', async () => {
    const result = await resolveSeoulBusArrival(
      request,
      provider(routeStops(20, 10)),
      new AbortController().signal,
    )

    expect(result.result?.status).toBe('stop_match_review_required')
  })

  it('가까운 정류장의 이름이 다르면 임의 선택하지 않는다', async () => {
    const fakeProvider = provider()
    vi.mocked(fakeProvider.getNearbyStops).mockReset().mockResolvedValueOnce([{
      stopId: 'OPPOSITE',
      arsId: '04294',
      name: '반대편정류장',
      coordinate: request.boardingStop.coordinate,
    }])

    const result = await resolveSeoulBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
    )

    expect(result.result?.status).toBe('stop_match_review_required')
    expect(fakeProvider.getRoutesAtStop).not.toHaveBeenCalled()
  })

  it('같은 이름의 반대편 후보가 둘 다 검증되면 하나를 임의 선택하지 않는다', async () => {
    const stops = routeStops()
    stops[20] = {
      ...stops[20],
      stopId: 'OPPOSITE',
      stopName: '우리은행화양동지점',
      estimates: [
        { order: 1, arrivalSeconds: 240, remainingStops: 4, message: '4분 후' },
      ],
    }
    const fakeProvider = provider(stops)
    vi.mocked(fakeProvider.getNearbyStops).mockReset()
      .mockResolvedValueOnce([{
        stopId: '103000189', arsId: '04293',
        name: '우리은행화양동지점',
        coordinate: request.boardingStop.coordinate,
      }, {
        stopId: 'OPPOSITE', arsId: '04294',
        name: '우리은행화양동지점',
        coordinate: { latitude: 37.54815, longitude: 127.06615 },
      }])
      .mockResolvedValueOnce([{
        stopId: '104000001', arsId: '05200',
        name: '건대입구역사거리.건대병원',
        coordinate: request.alightingStop.coordinate,
      }])

    const result = await resolveSeoulBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
    )

    expect(result.result?.status).toBe('stop_match_review_required')
  })

  it('서울시 인근 정류장이 없으면 기존 TAGO로 넘길 수 있게 미처리한다', async () => {
    const fakeProvider = provider()
    vi.mocked(fakeProvider.getNearbyStops).mockReset().mockResolvedValue([])

    await expect(resolveSeoulBusArrival(
      request,
      fakeProvider,
      new AbortController().signal,
    )).resolves.toEqual({ handled: false, result: null })
  })
})
