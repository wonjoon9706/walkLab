import type { KakaoTransitMode } from './kakaoTransitRoute'
import type {
  TransitAccessSpeedBasis,
  TransitAccessSpeedInput,
} from './transitAccessWalk'
import type { GeoCoordinate, WalkingRoute } from './walkingRoute'

export type TransitEgressMode = Extract<KakaoTransitMode, 'BUS' | 'SUBWAY'>

export interface TransitEgressDestination {
  name: string
  coordinate: GeoCoordinate
  source: 'user_selected_place'
  providerPlaceId: string | null
}

export type TransitEgressPoint =
  | {
      mode: 'BUS'
      alightingPointName: string
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
  | {
      mode: 'SUBWAY'
      alightingPointName: string
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

export interface TransitEgressWalk {
  sourceRouteId: string
  lastTransitStepIndex: number
  mode: TransitEgressMode
  alightingPoint: TransitEgressPoint
  destination: TransitEgressDestination
  walkingRoute: WalkingRoute
  endpointGapsM: {
    start: number
    destination: number
  }
  endpointVerification: 'verified'
  pureWalkingDurationSeconds: number
  speedBasis: TransitAccessSpeedBasis
  internalStationEgress: {
    status: 'unknown' | 'not_applicable'
    durationSeconds: null
  }
  providerTransitTotalDurationSeconds: number
  personalizedTotalEtaSeconds: null
  totalEtaStatus: 'not_calculated'
  totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED'
}

export type TransitEgressReviewReason =
  | 'NO_TRANSIT_STEP'
  | 'MODE_MISMATCH'
  | 'ALIGHTING_NAME_MISMATCH'
  | 'VEHICLE_EVIDENCE_MISSING'
  | 'MULTIPLE_VEHICLE_OPTIONS'
  | 'ROUTE_NAME_MISMATCH'
  | 'WALKING_ROUTE_EMPTY'
  | 'WALKING_ENDPOINT_MISMATCH'
  | 'INVALID_REFERENCE_SPEED'

export type TransitEgressWalkResult =
  | { status: 'ready'; egressWalk: TransitEgressWalk }
  | { status: 'review_required'; reason: TransitEgressReviewReason }

export interface BuildTransitEgressWalkInput {
  routeId: string
  routeTotalDurationSeconds: number
  lastTransitStepIndex: number
  mode: TransitEgressMode
  expectedAlightingName: string
  expectedRouteName: string
  actualVehicleNames: string[]
  alightingPoint: TransitEgressPoint
  destination: TransitEgressDestination
  walkingRoute: WalkingRoute
  speed: TransitAccessSpeedInput
}
