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
  routeId: string
  routeName: string
  routeType: string | null
  stopId: string
  arsId: string | null
  stopName: string
  sequence: number
  estimates: BusArrivalEstimate[]
}
