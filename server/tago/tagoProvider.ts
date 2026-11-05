import type {
  TagoArrivalRecord,
  TagoCityCode,
  TagoStopCandidate,
  TagoStopRoute,
  TagoRouteStop,
  TagoDiagnosticStage,
} from '../../src/domain/busArrival.js'
import {
  parseTagoArrivals,
  parseTagoCityCodes,
  parseTagoNearbyStops,
  parseTagoRoutesAtStop,
  parseTagoRouteStopsPage,
  TagoResponseError,
} from '../../src/services/transitArrival/tagoResponseParser.js'

const TAGO_ARRIVAL_BASE_URL =
  'https://apis.data.go.kr/1613000/ArvlInfoInqireService'
const TAGO_STOP_BASE_URL =
  'https://apis.data.go.kr/1613000/BusSttnInfoInqireService'
const TAGO_ROUTE_BASE_URL =
  'https://apis.data.go.kr/1613000/BusRouteInfoInqireService'
const ROUTE_STOP_CACHE_TTL_MS = 6 * 60 * 60 * 1_000
const ROUTE_STOP_PAGE_SIZE = 100
const MAX_ROUTE_STOP_PAGES = 50
const MAX_ROUTE_STOP_CACHE_ENTRIES = 100

const routeStopCache = new Map<string, {
  expiresAt: number
  stops: TagoRouteStop[]
}>()

export class TagoHttpError extends Error {
  constructor(public readonly status: number) {
    super('TAGO HTTP 요청이 실패했습니다.')
    this.name = 'TagoHttpError'
  }
}

export class TagoProviderStageError extends Error {
  constructor(
    public readonly stage: TagoDiagnosticStage,
    public readonly originalError: unknown,
  ) {
    super(`TAGO ${stage} 단계 요청이 실패했습니다.`)
    this.name = 'TagoProviderStageError'
  }
}

interface TagoProviderDependencies {
  fetch: typeof fetch
  serviceKey: string
  now?: () => number
}

export interface TagoProvider {
  getCityCodes(signal: AbortSignal): Promise<TagoCityCode[]>
  getNearbyStops(
    coordinate: { latitude: number; longitude: number },
    signal: AbortSignal,
  ): Promise<TagoStopCandidate[]>
  getRoutesAtStop(
    cityCode: string,
    nodeId: string,
    signal: AbortSignal,
  ): Promise<TagoStopRoute[]>
  getRouteStops(
    cityCode: string,
    routeId: string,
    signal: AbortSignal,
  ): Promise<TagoRouteStop[]>
  getArrivals(
    cityCode: string,
    nodeId: string,
    signal: AbortSignal,
  ): Promise<TagoArrivalRecord[]>
}

export function createTagoProvider(
  dependencies: TagoProviderDependencies,
): TagoProvider {
  const now = dependencies.now ?? Date.now

  async function withStage<T>(
    stage: TagoDiagnosticStage,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw new TagoProviderStageError(stage, error)
    }
  }

  async function request(
    baseUrl: string,
    operation: string,
    parameters: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    const search = new URLSearchParams({
      serviceKey: dependencies.serviceKey,
      _type: 'json',
      ...parameters,
    })
    const response = await dependencies.fetch(
      `${baseUrl}/${operation}?${search.toString()}`,
      { method: 'GET', signal },
    )
    if (!response.ok) throw new TagoHttpError(response.status)
    return response.text()
  }

  return {
    async getCityCodes(signal) {
      return withStage('city_codes', async () => {
        const text = await request(
          TAGO_ARRIVAL_BASE_URL,
          'getCtyCodeList',
          {},
          signal,
        )
        return parseTagoCityCodes(text)
      })
    },

    async getNearbyStops(coordinate, signal) {
      return withStage('nearby_stops', async () => {
        const text = await request(
          TAGO_STOP_BASE_URL,
          'getCrdntPrxmtSttnList',
          {
            pageNo: '1',
            numOfRows: '10',
            gpsLati: coordinate.latitude.toString(),
            gpsLong: coordinate.longitude.toString(),
          },
          signal,
        )
        return parseTagoNearbyStops(text)
      })
    },

    async getRoutesAtStop(cityCode, nodeId, signal) {
      return withStage('routes_at_stop', async () => {
        const text = await request(
          TAGO_STOP_BASE_URL,
          'getSttnThrghRouteList',
          {
            pageNo: '1',
            numOfRows: '100',
            cityCode,
            nodeId,
          },
          signal,
        )
        return parseTagoRoutesAtStop(text)
      })
    },

    async getRouteStops(cityCode, routeId, signal) {
      const cacheKey = `${cityCode}|${routeId}`
      const currentTime = now()
      const cached = routeStopCache.get(cacheKey)
      if (cached !== undefined && cached.expiresAt > currentTime) {
        return cached.stops
      }

      return withStage('route_stops', async () => {
        const stops: TagoRouteStop[] = []
        let pageNo = 1
        let hasMore = true
        while (hasMore) {
        const text = await request(
          TAGO_ROUTE_BASE_URL,
          'getRouteAcctoThrghSttnList',
          {
            pageNo: pageNo.toString(),
            numOfRows: ROUTE_STOP_PAGE_SIZE.toString(),
            cityCode,
            routeId,
          },
          signal,
        )
        const page = parseTagoRouteStopsPage(text)
        const totalCount = page.totalCount
        if (page.stops.length === 0 && stops.length < totalCount) {
          throw new TagoResponseError(
            'invalid_response',
            null,
            'TAGO 노선 경유 정류장 페이지가 비어 있습니다.',
          )
        }
        stops.push(...page.stops)
        pageNo += 1
        if (pageNo > MAX_ROUTE_STOP_PAGES && stops.length < totalCount) {
          throw new TagoResponseError(
            'invalid_response',
            null,
            'TAGO 노선 경유 정류장 페이지 수가 허용 범위를 초과했습니다.',
          )
        }
        hasMore = stops.length < totalCount
      }

        while (routeStopCache.size >= MAX_ROUTE_STOP_CACHE_ENTRIES) {
          const oldestKey = routeStopCache.keys().next().value
          if (typeof oldestKey !== 'string') break
          routeStopCache.delete(oldestKey)
        }
        routeStopCache.set(cacheKey, {
          stops,
          expiresAt: currentTime + ROUTE_STOP_CACHE_TTL_MS,
        })
        return stops
      })
    },

    async getArrivals(cityCode, nodeId, signal) {
      return withStage('arrivals', async () => {
        const text = await request(
          TAGO_ARRIVAL_BASE_URL,
          'getSttnAcctoArvlPrearngeInfoList',
          {
            pageNo: '1',
            numOfRows: '100',
            cityCode,
            nodeId,
          },
          signal,
        )
        return parseTagoArrivals(text)
      })
    },
  }
}

export function resetTagoProviderCacheForTests(): void {
  routeStopCache.clear()
}
