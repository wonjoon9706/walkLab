import type { SubwayEntranceCandidateEvidence } from './transitBoardingPoint'
import type { TransitEgressWalk } from './transitEgressWalk'
import type { TransitEgressReviewReason } from './transitEgressWalk'
import type {
  GeoCoordinate,
  WalkingRoute,
  WalkingRouteErrorCode,
} from './walkingRoute'

export interface BusAlightingPointCandidateEvidence {
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
}

export type AutomaticTransitEgressReviewReason =
  | 'NO_TRANSIT_STEP'
  | 'TRANSIT_STEP_COORDINATE_MISSING'
  | 'ALIGHTING_STOP_EVIDENCE_MISSING'
  | 'VEHICLE_EVIDENCE_MISSING'
  | 'MULTIPLE_VEHICLE_OPTIONS'
  | 'NO_VERIFIED_BUS_STOP'
  | 'MULTIPLE_VERIFIED_BUS_STOPS'
  | 'NO_VERIFIED_SUBWAY_EXIT'
  | 'MULTIPLE_SUBWAY_EXITS'
  | 'WALKING_ROUTE_FAILED'
  | 'EGRESS_WALK_REVIEW_REQUIRED'

export type AutomaticTransitEgressResult =
  | {
      status: 'ready'
      egressWalk: TransitEgressWalk
      busCandidates: BusAlightingPointCandidateEvidence[]
      subwayCandidates: SubwayEntranceCandidateEvidence[]
    }
  | {
      status: 'review_required'
      reason: AutomaticTransitEgressReviewReason
      detailReason?: TransitEgressReviewReason
      busCandidates: BusAlightingPointCandidateEvidence[]
      subwayCandidates: SubwayEntranceCandidateEvidence[]
    }
