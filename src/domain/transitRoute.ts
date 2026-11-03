import type { GeoCoordinate, WalkingSpeedProfile } from './walkingRoute'

export type TransitMode =
  | 'WALK'
  | 'BUS'
  | 'SUBWAY'
  | 'EXPRESSBUS'
  | 'TRAIN'
  | 'AIRPLANE'
  | 'FERRY'

export interface TransitStop {
  index: number
  providerStopId: string
  name: string
  coordinate: GeoCoordinate
}

export interface TransitRouteLeg {
  mode: TransitMode
  distanceM: number
  durationSeconds: number
  routeName: string | null
  routeId?: string | null
  routeColor: string | null
  routeType: number | null
  startName: string
  endName: string
  startCoordinate?: GeoCoordinate | null
  endCoordinate?: GeoCoordinate | null
  coordinates: GeoCoordinate[]
  stops?: TransitStop[]
}

export interface TransitItinerary {
  id: string
  totalDurationSeconds: number
  totalWalkDurationSeconds: number
  totalWalkDistanceM: number
  totalDistanceM: number
  transferCount: number
  fareKrw: number | null
  legs: TransitRouteLeg[]
}

export interface TransitRouteResult {
  itineraries: TransitItinerary[]
  provider: 'tmap-transit'
  requestedAt: string
}

export interface TransitEtaEstimate {
  providerDurationSeconds: number
  appliedDurationSeconds: number
  personalizedWalkDurationSeconds: number | null
  personalizationScope: 'pure_walking_reference' | 'provider_fallback'
  unverifiedWalkOverheadSeconds: null
  arrivalAt: string
  speedProfile: WalkingSpeedProfile
}

export type TransitRouteErrorCode =
  | 'AUTH_SESSION_MISSING'
  | 'AUTH_HEADER_MISSING'
  | 'AUTH_TOKEN_INVALID'
  | 'SERVER_AUTH_NOT_CONFIGURED'
  | 'SERVER_NOT_CONFIGURED'
  | 'USER_NOT_ALLOWED'
  | 'PRODUCTION_DISABLED'
  | 'INVALID_REQUEST'
  | 'ROUTE_NOT_FOUND'
  | 'TMAP_AUTH_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'

export class TransitRouteError extends Error {
  constructor(
    public readonly code: TransitRouteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TransitRouteError'
  }
}
