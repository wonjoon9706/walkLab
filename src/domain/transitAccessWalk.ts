import type { KakaoTransitMode } from './kakaoTransitRoute'
import type { WalkingSpeedModel } from './walkingSpeedModel'
import type { GeoCoordinate, WalkingRoute } from './walkingRoute'

export type TransitAccessMode = Extract<KakaoTransitMode, 'BUS' | 'SUBWAY'>

export interface TransitAccessOrigin {
  coordinate: GeoCoordinate
  verification:
    | 'representative_coordinate'
    | 'confirmed_entrance'
    | 'current_location'
    | 'searched_place'
    | 'map_coordinate'
  note: string | null
}

export type TransitAccessTarget =
  | {
      mode: 'SUBWAY'
      boardingPointName: string
      routeName: string
      locationName: string
      coordinate: GeoCoordinate
      source: 'kakao_place_subway_entrance'
      providerPlaceId: string
      verification: 'explicit_subway_entrance'
      categoryName: string
      closureStatus: 'unknown' | 'confirmed_open'
      lineAccessStatus: 'unverified'
      selectionBasis: 'shortest_valid_external_walk'
      selectionConfidence: 'provisional'
      internalStationTimeIncluded: false
    }
  | {
      mode: 'BUS'
      boardingPointName: string
      routeName: string
      locationName: string
      coordinate: GeoCoordinate
      source: 'seoul_bus_stop'
      providerStopId: string
      arsId: string
      providerRouteId: string
      verification: 'verified_bus_stop'
      directionVerification: 'route_stop_order'
    }

export type TransitAccessSpeedInput =
  | { kind: 'g7_model'; model: WalkingSpeedModel | null }
  | { kind: 'reference_only'; speedMps: number; label: string }

export interface TransitAccessSpeedBasis {
  kind: 'g7_personalized' | 'g7_default_fallback' | 'reference_only'
  speedMps: number
  modelVersion: WalkingSpeedModel['algorithmVersion'] | 'default-v1' | null
  validSessionCount: number | null
  label: string | null
}

export interface TransitAccessWalk {
  sourceRouteId: string
  firstTransitStepIndex: number
  mode: TransitAccessMode
  origin: TransitAccessOrigin
  target: TransitAccessTarget
  walkingRoute: WalkingRoute
  endpointGapsM: {
    start: number
    destination: number
  }
  endpointVerification: 'verified'
  pureWalkingDurationSeconds: number
  speedBasis: TransitAccessSpeedBasis
  internalStationAccess: {
    status: 'unknown' | 'not_applicable'
    durationSeconds: null
  }
  providerTransitTotalDurationSeconds: number
  personalizedTotalEtaSeconds: null
  totalEtaStatus: 'not_calculated'
  totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED'
}

export type TransitAccessReviewReason =
  | 'NO_TRANSIT_STEP'
  | 'MODE_MISMATCH'
  | 'BOARDING_NAME_MISMATCH'
  | 'VEHICLE_EVIDENCE_MISSING'
  | 'MULTIPLE_VEHICLE_OPTIONS'
  | 'ROUTE_NAME_MISMATCH'
  | 'WALKING_ROUTE_EMPTY'
  | 'WALKING_ENDPOINT_MISMATCH'
  | 'INVALID_REFERENCE_SPEED'

export type TransitAccessWalkResult =
  | { status: 'ready'; accessWalk: TransitAccessWalk }
  | { status: 'review_required'; reason: TransitAccessReviewReason }

export type TransitWalkDiagnostic = 'PRODUCTION_DISABLED' | 'STOP_CANDIDATES_EMPTY' |
  'STOP_DIRECTION_MISMATCH' | 'MULTIPLE_CANDIDATES' | 'STOP_API_FAILED' |
  'G8_REQUEST_FAILED' | 'G8_SNAP_MISMATCH' | 'G8_EVIDENCE_EXCLUDED' |
  'API_NOT_CONFIGURED' | 'API_AUTH_ERROR' | 'API_TIMEOUT' | 'API_QUOTA_EXCEEDED' |
  'API_INVALID_RESPONSE' | 'API_CONNECTION_FAILED' | 'API_PROVIDER_ERROR'

export interface TransitPathReferenceWalk {
  source: 'kakao_bus_path_endpoint'
  stepIndex: number
  scope: 'access' | 'egress'
  locationName: string
  requestedStart: GeoCoordinate
  requestedDestination: GeoCoordinate
  walkingRoute: WalkingRoute
  startGapM: number
  destinationGapM: number
  verification: 'unverified_boarding_point'
}
