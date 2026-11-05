import type { BusArrivalEstimate } from './busArrival.js'
import type { GeoCoordinate } from './walkingRoute.js'

export interface SeoulBusStop {
  stopId: string
  arsId: string
  name: string
  coordinate: GeoCoordinate
}

export interface SeoulBusRoute {
  routeId: string
  routeName: string
  routeType: string | null
}

export interface SeoulRouteStopArrival {
  /** 정규화 응답을 최초 수신한 시각. 캐시 재사용 시에는 변경하지 않는다. */
  fetchedAt?: string
  routeId: string
  routeName: string
  routeType: string | null
  stopId: string
  arsId: string | null
  stopName: string
  sequence: number
  estimates: BusArrivalEstimate[]
}
