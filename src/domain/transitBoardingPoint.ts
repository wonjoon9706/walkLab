import type { TransitAccessWalk } from './transitAccessWalk'
import type { TransitAccessReviewReason } from './transitAccessWalk'
import type { BusArrivalEstimate } from './busArrival'
import type { TransitPathReferenceWalk, TransitWalkDiagnostic } from './transitAccessWalk'
import type {
  GeoCoordinate,
  PlaceSearchResult,
  WalkingRoute,
  WalkingRouteErrorCode,
} from './walkingRoute'

export interface BusBoardingPointCandidateEvidence {
  stopId: string
  arsId: string
  stopName: string
  coordinate: GeoCoordinate
  routeId: string
  routeName: string
  distanceFromSearchAnchorM: number
  orderedStopNames: string[]
  walkingRouteStatus: 'not_requested' | 'available' | 'failed'
  walkingRoute: WalkingRoute | null
  walkingDistanceM: number | null
  walkingProviderDurationSeconds: number | null
  startGapM: number | null
  destinationGapM: number | null
  walkingErrorCode: WalkingRouteErrorCode | null
  arrivalEstimates: BusArrivalEstimate[]
  arrivalFetchedAt: string | null
}

export interface BusBoardingStopDiagnostic {
  stopId: string
  arsId: string
  stopName: string
  distanceFromSearchAnchorM: number
  nameMatched: boolean
  withinSearchDistance: boolean
  routeMatches: Array<{
    routeId: string
    routeName: string
    directionVerified: boolean
    reason: 'VERIFIED' | 'ROUTE_STOP_ID_MISMATCH' | 'STOP_ORDER_MISMATCH'
  }>
  outcome:
    | 'NAME_MISMATCH'
    | 'DISTANCE_EXCEEDED'
    | 'ROUTE_MISMATCH'
    | 'DIRECTION_MISMATCH'
    | 'VERIFIED'
}

export interface BusBoardingResolutionDiagnostics {
  searchAnchorSource: 'kakao_bus_path_first_coordinate'
  searchRadiusM: number
  nearbyStopCount: number
  expectedStopName: string
  vehicleNames: string[]
  orderedStopNames: string[]
  candidates: BusBoardingStopDiagnostic[]
}

export type SubwayEntranceClosureStatus =
  | 'unknown'
  | 'confirmed_closed'

export interface SubwayEntranceCandidateEvidence {
  place: PlaceSearchResult
  closureStatus: SubwayEntranceClosureStatus
  stationNameMatches: boolean
  lineMatches: boolean
  entranceCategoryMatches: boolean
  walkingRouteStatus: 'not_requested' | 'available' | 'failed'
  walkingRoute: WalkingRoute | null
  prefilterStatus:
    | 'ineligible'
    | 'selected_for_g8'
    | 'skipped_by_limit'
  straightDistanceM: number | null
  walkingDistanceM: number | null
  walkingProviderDurationSeconds: number | null
  startGapM: number | null
  destinationGapM: number | null
  walkingErrorCode: WalkingRouteErrorCode | null
  selectionDurationSeconds: number | null
  selectionTimeBasis: 'g7_personalized' | 'g8_provider' | null
  selectionRank: number | null
}

export type AutomaticTransitAccessReviewReason =
  | 'NO_TRANSIT_STEP'
  | 'TRANSIT_STEP_COORDINATE_MISSING'
  | 'BOARDING_STOP_EVIDENCE_MISSING'
  | 'VEHICLE_EVIDENCE_MISSING'
  | 'MULTIPLE_VEHICLE_OPTIONS'
  | 'NO_VERIFIED_BUS_STOP'
  | 'MULTIPLE_VERIFIED_BUS_STOPS'
  | 'NO_VERIFIED_SUBWAY_ENTRANCE'
  | 'ACCESS_WALK_START_SNAP_MISMATCH'
  | 'ACCESS_WALK_DESTINATION_SNAP_MISMATCH'
  | 'ACCESS_WALK_ENDPOINT_SNAP_MISMATCH'
  | 'MULTIPLE_SUBWAY_ENTRANCES'
  | 'SUBWAY_ENTRANCE_LINE_ACCESS_UNVERIFIED'
  | 'WALKING_ROUTE_FAILED'
  | 'ACCESS_WALK_REVIEW_REQUIRED'

export type AutomaticTransitAccessResult =
  | {
      status: 'ready'
      accessWalk: TransitAccessWalk
      busCandidates: BusBoardingPointCandidateEvidence[]
      busDiagnostics: BusBoardingResolutionDiagnostics | null
      subwayCandidates: SubwayEntranceCandidateEvidence[]
    }
  | {
      status: 'review_required'
      reason: AutomaticTransitAccessReviewReason
      detailReason?: TransitAccessReviewReason
      referenceWalk?: TransitPathReferenceWalk
      referenceWalkIssue?: TransitWalkDiagnostic
      diagnosticCode?: TransitWalkDiagnostic
      busLookupErrorCode?: string
      busCandidates: BusBoardingPointCandidateEvidence[]
      busDiagnostics: BusBoardingResolutionDiagnostics | null
      subwayCandidates: SubwayEntranceCandidateEvidence[]
    }
