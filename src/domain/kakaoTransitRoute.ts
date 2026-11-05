import type { GeoCoordinate } from './walkingRoute.js'

export type KakaoTransitMode = 'BUS' | 'SUBWAY' | 'WALKING'

export type KakaoTransitRouteType = 'BUS' | 'SUBWAY' | 'BUS_AND_SUBWAY'

export interface KakaoTransitStopEvidence {
  index: number
  name: string
}

export interface KakaoTransitVehicleEvidence {
  index: number
  name: string
  type: string | null
}

export interface KakaoTransitStep {
  index: number
  mode: KakaoTransitMode
  guidance: string
  distanceM: number
  durationSeconds: number
  stops: KakaoTransitStopEvidence[]
  vehicles: KakaoTransitVehicleEvidence[]
  coordinates: GeoCoordinate[]
}

export interface KakaoTransitFare {
  value: number | null
  min: number | null
  max: number | null
}

export interface KakaoTransitRoute {
  id: string
  type: KakaoTransitRouteType
  totalDistanceM: number
  totalDurationSeconds: number
  transferCount: number
  fare: KakaoTransitFare | null
  steps: KakaoTransitStep[]
}

export interface KakaoTransitRejectedRoute {
  routeIndex: number
  reason: 'INVALID_ROUTE_PROPERTIES' | 'NO_VALID_STEPS'
}

export interface KakaoTransitRouteResult {
  provider: 'kakao-map-publictraffic'
  requestedAt: string
  reportedRouteCounts: {
    total: number
    bus: number
    subway: number
    busAndSubway: number
  }
  routes: KakaoTransitRoute[]
  rejectedRoutes: KakaoTransitRejectedRoute[]
}

export type KakaoTransitResponseErrorCode =
  | 'ROUTE_NOT_FOUND'
  | 'INVALID_RESPONSE'

export class KakaoTransitResponseError extends Error {
  constructor(
    public readonly code: KakaoTransitResponseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'KakaoTransitResponseError'
  }
}
