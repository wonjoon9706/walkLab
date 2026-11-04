import { describe, expect, it, vi } from 'vitest'
import { createTransitDetailRequestCache } from './transitDetailRequestCache'

const start = { latitude: 37.5, longitude: 127 }
const destination = { latitude: 37.51, longitude: 127.01 }

describe('대중교통 상세 요청 캐시', () => {
  it('같은 장소·도보·버스 증거 요청을 검색 단위에서 공유한다', async () => {
    const getWalkingRoute = vi.fn(async () => ({
      distanceM: 100,
      providerDurationSeconds: 80,
      coordinates: [start, destination],
      provider: 'kakao-walking-route' as const,
      requestedAt: '2026-11-04T00:00:00.000Z',
    }))
    const searchPlaces = vi.fn(async () => [])
    const getNearbyStops = vi.fn(async () => [])
    const getRoutesAtStop = vi.fn(async () => [])
    const getRouteArrivals = vi.fn(async () => [])
    const cache = createTransitDetailRequestCache({
      getWalkingRoute,
      searchPlaces,
      seoulBusProvider: { getNearbyStops, getRoutesAtStop, getRouteArrivals },
    })
    const controller = new AbortController()

    await Promise.all([
      cache.getWalkingRoute({ start, destination }),
      cache.getWalkingRoute({ start, destination }),
      cache.searchPlaces('테스트역 출구', start),
      cache.searchPlaces('테스트역 출구', start),
      cache.seoulBusProvider.getNearbyStops(start, controller.signal),
      cache.seoulBusProvider.getNearbyStops(start, controller.signal),
      cache.seoulBusProvider.getRoutesAtStop('10001', controller.signal),
      cache.seoulBusProvider.getRoutesAtStop('10001', controller.signal),
      cache.seoulBusProvider.getRouteArrivals('route-1', controller.signal),
      cache.seoulBusProvider.getRouteArrivals('route-1', controller.signal),
    ])

    expect(getWalkingRoute).toHaveBeenCalledTimes(1)
    expect(searchPlaces).toHaveBeenCalledTimes(1)
    expect(getNearbyStops).toHaveBeenCalledTimes(1)
    expect(getRoutesAtStop).toHaveBeenCalledTimes(1)
    expect(getRouteArrivals).toHaveBeenCalledTimes(1)
    expect(cache.stats).toEqual({
      walkingRouteRequests: 1,
      walkingRouteDurationMs: expect.any(Number),
      candidateLookupDurationMs: expect.any(Number),
      cacheHits: 5,
      failedRequests: 0,
      timedOutRequests: 0,
      placeSearchRequests: 1,
      nearbyStopRequests: 1,
      routesAtStopRequests: 1,
      routeArrivalRequests: 1,
    })
  })

  it('G8 실제 요청 동시 실행 수를 제한한다', async () => {
    let active = 0
    let maximumActive = 0
    const resolvers: Array<() => void> = []
    const getWalkingRoute = vi.fn(async (request: { start: typeof start; destination: typeof destination }) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise<void>((resolve) => resolvers.push(resolve))
      active -= 1
      return {
        distanceM: 100,
        providerDurationSeconds: 80,
        coordinates: [request.start, request.destination],
        provider: 'kakao-walking-route' as const,
        requestedAt: '2026-11-04T00:00:00.000Z',
      }
    })
    const cache = createTransitDetailRequestCache({
      getWalkingRoute,
      searchPlaces: async () => [],
      seoulBusProvider: {
        getNearbyStops: async () => [],
        getRoutesAtStop: async () => [],
        getRouteArrivals: async () => [],
      },
    }, 2)
    const requests = [0, 1, 2, 3].map((index) => cache.getWalkingRoute({
      start,
      destination: { ...destination, longitude: destination.longitude + index * 0.001 },
    }))

    await vi.waitFor(() => expect(getWalkingRoute).toHaveBeenCalledTimes(2))
    resolvers.splice(0).forEach((resolve) => resolve())
    await vi.waitFor(() => expect(getWalkingRoute).toHaveBeenCalledTimes(4))
    resolvers.splice(0).forEach((resolve) => resolve())
    await Promise.all(requests)

    expect(maximumActive).toBe(2)
  })

  it('검색 한 번의 G8 실제 요청 예산을 초과하지 않는다', async () => {
    const getWalkingRoute = vi.fn(async (request: { start: typeof start; destination: typeof destination }) => ({
      distanceM: 100,
      providerDurationSeconds: 80,
      coordinates: [request.start, request.destination],
      provider: 'kakao-walking-route' as const,
      requestedAt: '2026-11-04T00:00:00.000Z',
    }))
    const cache = createTransitDetailRequestCache({
      getWalkingRoute,
      searchPlaces: async () => [],
      seoulBusProvider: {
        getNearbyStops: async () => [],
        getRoutesAtStop: async () => [],
        getRouteArrivals: async () => [],
      },
    }, 2, 2)

    const results = await Promise.allSettled([0, 1, 2].map((index) =>
      cache.getWalkingRoute({
        start,
        destination: { ...destination, longitude: destination.longitude + index * 0.001 },
      }),
    ))

    expect(getWalkingRoute).toHaveBeenCalledTimes(2)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('응답이 멈춘 G8 요청을 시간초과로 구분하고 다음 요청을 처리한다', async () => {
    vi.useFakeTimers()
    try {
      const getWalkingRoute = vi.fn()
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValue({ distanceM: 100 })
      const cache = createTransitDetailRequestCache({
        getWalkingRoute,
        searchPlaces: async () => [],
        seoulBusProvider: {
          getNearbyStops: async () => [], getRoutesAtStop: async () => [],
          getRouteArrivals: async () => [],
        },
      }, 1, 30, 100)
      const first = cache.getWalkingRoute({ start, destination })
      const failure = expect(first).rejects.toThrow('TRANSIT_DETAIL_REQUEST_TIMEOUT')
      const second = cache.getWalkingRoute({ start: destination, destination: start })
      await vi.advanceTimersByTimeAsync(100)
      await failure
      await expect(second).resolves.toEqual({ distanceM: 100 })
      expect(cache.stats.timedOutRequests).toBe(1)
      expect(cache.stats.failedRequests).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
