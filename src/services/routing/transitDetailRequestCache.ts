import type { SeoulBusProvider } from '../../../server/tago/seoulBusProvider'
import type {
  GeoCoordinate,
  PlaceSearchResult,
  WalkingRoute,
} from '../../domain/walkingRoute'

interface Dependencies {
  getWalkingRoute(request: {
    start: GeoCoordinate
    destination: GeoCoordinate
  }): Promise<WalkingRoute>
  searchPlaces(query: string, origin: GeoCoordinate): Promise<PlaceSearchResult[]>
  seoulBusProvider: Pick<
    SeoulBusProvider,
    'getNearbyStops' | 'getRoutesAtStop' | 'getRouteArrivals'
  >
}

export interface TransitDetailRequestStats {
  walkingRouteRequests: number
  walkingRouteDurationMs: number
  candidateLookupDurationMs: number
  cacheHits: number
  failedRequests: number
  timedOutRequests: number
  placeSearchRequests: number
  nearbyStopRequests: number
  routesAtStopRequests: number
  routeArrivalRequests: number
}

export interface TransitDetailRequestCache {
  getWalkingRoute: Dependencies['getWalkingRoute']
  searchPlaces: Dependencies['searchPlaces']
  seoulBusProvider: Dependencies['seoulBusProvider']
  stats: TransitDetailRequestStats
  cancelQueuedWalkingRequests(): void
}

function coordinateKey(coordinate: GeoCoordinate): string {
  return `${coordinate.latitude.toFixed(7)}:${coordinate.longitude.toFixed(7)}`
}

function walkingKey(request: {
  start: GeoCoordinate
  destination: GeoCoordinate
}): string {
  return `${coordinateKey(request.start)}>${coordinateKey(request.destination)}`
}

export function createTransitDetailRequestCache(
  dependencies: Dependencies,
  maxConcurrentWalkingRequests = 3,
  maxWalkingRequests = 30,
  requestTimeoutMs = 25_000,
): TransitDetailRequestCache {
  const walkingCache = new Map<string, Promise<WalkingRoute>>()
  const placeCache = new Map<string, Promise<PlaceSearchResult[]>>()
  const nearbyStopCache = new Map<string, ReturnType<Dependencies['seoulBusProvider']['getNearbyStops']>>()
  const routesAtStopCache = new Map<string, ReturnType<Dependencies['seoulBusProvider']['getRoutesAtStop']>>()
  const routeArrivalCache = new Map<string, ReturnType<Dependencies['seoulBusProvider']['getRouteArrivals']>>()
  const walkingQueue: Array<() => void> = []
  const stats: TransitDetailRequestStats = {
    walkingRouteRequests: 0,
    walkingRouteDurationMs: 0,
    candidateLookupDurationMs: 0,
    cacheHits: 0,
    failedRequests: 0,
    timedOutRequests: 0,
    placeSearchRequests: 0,
    nearbyStopRequests: 0,
    routesAtStopRequests: 0,
    routeArrivalRequests: 0,
  }
  let activeWalkingRequests = 0
  let canceled = false

  // 서버 자체의 타임아웃과 별도로 로컬 서버 연결이 멈춰도 계산 슬롯을 반환한다.
  function withDeadline<T>(request: Promise<T>, walking: boolean): Promise<T> {
    const startedAt = performance.now()
    let timer: ReturnType<typeof setTimeout>
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        stats.timedOutRequests += 1
        reject(new Error('TRANSIT_DETAIL_REQUEST_TIMEOUT'))
      }, requestTimeoutMs)
    })
    return Promise.race([request, deadline]).catch((error: unknown) => {
      stats.failedRequests += 1
      throw error
    }).finally(() => {
      clearTimeout(timer)
      if (!walking) stats.candidateLookupDurationMs += performance.now() - startedAt
    })
  }

  function pumpWalkingQueue() {
    while (
      !canceled &&
      activeWalkingRequests < maxConcurrentWalkingRequests &&
      walkingQueue.length > 0
    ) {
      walkingQueue.shift()?.()
    }
  }

  function runLimitedWalkingRequest(request: {
    start: GeoCoordinate
    destination: GeoCoordinate
  }): Promise<WalkingRoute> {
    return new Promise((resolve, reject) => {
      const run = () => {
        if (canceled) {
          reject(new Error('TRANSIT_DETAIL_REQUEST_CANCELED'))
          return
        }
        if (stats.walkingRouteRequests >= maxWalkingRequests) {
          reject(new Error('TRANSIT_DETAIL_WALKING_BUDGET_EXCEEDED'))
          return
        }
        activeWalkingRequests += 1
        stats.walkingRouteRequests += 1
        const startedAt = performance.now()
        void withDeadline(dependencies.getWalkingRoute(request), true).then(resolve, reject).finally(() => {
          stats.walkingRouteDurationMs += performance.now() - startedAt
          activeWalkingRequests -= 1
          pumpWalkingQueue()
        })
      }
      walkingQueue.push(run)
      pumpWalkingQueue()
    })
  }

  function memoize<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    create: () => Promise<T>,
    walking = false,
  ): Promise<T> {
    const cached = cache.get(key)
    if (cached !== undefined) {
      stats.cacheHits += 1
      return cached
    }
    const promise = walking ? create() : withDeadline(create(), false)
    cache.set(key, promise)
    void promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key)
    })
    return promise
  }

  return {
    getWalkingRoute(request) {
      const key = walkingKey(request)
      return memoize(walkingCache, key, () => runLimitedWalkingRequest(request), true)
    },
    searchPlaces(query, origin) {
      const key = `${query}:${coordinateKey(origin)}`
      return memoize(placeCache, key, () => {
        stats.placeSearchRequests += 1
        return dependencies.searchPlaces(query, origin)
      })
    },
    seoulBusProvider: {
      getNearbyStops(coordinate, signal) {
        const key = coordinateKey(coordinate)
        return memoize(nearbyStopCache, key, () => {
          stats.nearbyStopRequests += 1
          return dependencies.seoulBusProvider.getNearbyStops(coordinate, signal)
        })
      },
      getRoutesAtStop(arsId, signal) {
        return memoize(routesAtStopCache, arsId, () => {
          stats.routesAtStopRequests += 1
          return dependencies.seoulBusProvider.getRoutesAtStop(arsId, signal)
        })
      },
      getRouteArrivals(routeId, signal) {
        return memoize(routeArrivalCache, routeId, () => {
          stats.routeArrivalRequests += 1
          return dependencies.seoulBusProvider.getRouteArrivals(routeId, signal)
        })
      },
    },
    stats,
    cancelQueuedWalkingRequests() {
      canceled = true
      const queued = walkingQueue.splice(0)
      for (const run of queued) run()
    },
  }
}
