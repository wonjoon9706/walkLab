import type { WalkingSpeedModel } from './walkingSpeedModel'

export interface GeoCoordinate {
  latitude: number
  longitude: number
}

export interface PlaceSearchResult {
  id: string
  name: string
  address: string
  roadAddress: string | null
  coordinate: GeoCoordinate
}

export interface WalkingRoute {
  distanceM: number
  providerDurationSeconds: number
  coordinates: GeoCoordinate[]
  provider: 'kakao-walking-route'
  requestedAt: string
}

export type WalkingSpeedSource = 'personalized' | 'default'

export interface WalkingSpeedProfile {
  speedMps: number
  source: WalkingSpeedSource
  modelVersion: WalkingSpeedModel['algorithmVersion'] | 'default-v1'
  validSessionCount: number
}

export interface WalkingEtaEstimate {
  appliedDurationSeconds: number
  defaultDurationSeconds: number
  providerDurationSeconds: number
  arrivalAt: string
  calculatedAt: string
  speedProfile: WalkingSpeedProfile
}

export type WalkingRouteErrorCode =
  | 'AUTH_SESSION_MISSING'
  | 'AUTH_HEADER_MISSING'
  | 'AUTH_TOKEN_INVALID'
  | 'SERVER_AUTH_NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'POINTS_TOO_CLOSE'
  | 'ROUTE_NOT_FOUND'
  | 'KAKAO_AUTH_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'SERVER_NOT_CONFIGURED'

export class WalkingRouteError extends Error {
  constructor(
    public readonly code: WalkingRouteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'WalkingRouteError'
  }
}
