import type { GeoCoordinate } from '../../src/domain/walkingRoute.js'
import type {
  SeoulBusRoute,
  SeoulBusStop,
  SeoulRouteStopArrival,
} from '../../src/domain/seoulBus.js'
import {
  parseSeoulNearbyStops,
  parseSeoulRouteArrivals,
  parseSeoulRoutesAtStop,
} from './seoulBusResponseParser.js'

const SEOUL_BUS_BASE_URL = 'http://ws.bus.go.kr/api/rest'
const SEOUL_NEARBY_RADIUS_M = 500

export type SeoulBusProviderStage =
  | 'nearby_stops'
  | 'routes_at_stop'
  | 'route_arrivals'

export class SeoulBusHttpError extends Error {
  constructor(public readonly status: number) {
    super('서울시 버스 HTTP 요청이 실패했습니다.')
    this.name = 'SeoulBusHttpError'
  }
}

export class SeoulBusProviderStageError extends Error {
  constructor(
    public readonly stage: SeoulBusProviderStage,
    public readonly originalError: unknown,
  ) {
    super(`서울시 버스 ${stage} 단계 요청이 실패했습니다.`)
    this.name = 'SeoulBusProviderStageError'
  }
}

interface SeoulBusProviderDependencies {
  fetch: typeof fetch
  serviceKey: string
  allowInsecureHttp: boolean
}

export interface SeoulBusProvider {
  getNearbyStops(
    coordinate: GeoCoordinate,
    signal: AbortSignal,
  ): Promise<SeoulBusStop[]>
  getRoutesAtStop(
    arsId: string,
    signal: AbortSignal,
  ): Promise<SeoulBusRoute[]>
  getRouteArrivals(
    routeId: string,
    signal: AbortSignal,
  ): Promise<SeoulRouteStopArrival[]>
}

export function createSeoulBusProvider(
  dependencies: SeoulBusProviderDependencies,
): SeoulBusProvider {
  async function request(
    stage: SeoulBusProviderStage,
    operation: string,
    parameters: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    if (!dependencies.allowInsecureHttp) {
      throw new SeoulBusProviderStageError(
        stage,
        new Error('서울시 버스 HTTP 호출이 허용되지 않은 환경입니다.'),
      )
    }
    try {
      const search = new URLSearchParams({
        ServiceKey: dependencies.serviceKey,
        resultType: 'json',
        ...parameters,
      })
      const response = await dependencies.fetch(
        `${SEOUL_BUS_BASE_URL}/${operation}?${search.toString()}`,
        { method: 'GET', signal, redirect: 'error' },
      )
      if (!response.ok) throw new SeoulBusHttpError(response.status)
      return response.text()
    } catch (error) {
      if (error instanceof SeoulBusProviderStageError) throw error
      throw new SeoulBusProviderStageError(stage, error)
    }
  }

  return {
    async getNearbyStops(coordinate, signal) {
      const text = await request(
        'nearby_stops',
        'stationinfo/getStationByPos',
        {
          tmX: coordinate.longitude.toString(),
          tmY: coordinate.latitude.toString(),
          radius: SEOUL_NEARBY_RADIUS_M.toString(),
        },
        signal,
      )
      return parseSeoulNearbyStops(text)
    },

    async getRoutesAtStop(arsId, signal) {
      const text = await request(
        'routes_at_stop',
        'stationinfo/getRouteByStation',
        { arsId },
        signal,
      )
      return parseSeoulRoutesAtStop(text)
    },

    async getRouteArrivals(routeId, signal) {
      const text = await request(
        'route_arrivals',
        'arrive/getArrInfoByRouteAll',
        { busRouteId: routeId },
        signal,
      )
      return parseSeoulRouteArrivals(text)
    },
  }
}
