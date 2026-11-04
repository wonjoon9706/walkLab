import type { TransitBoardingPlan } from '../../domain/transitBoarding'
import type { TransitItinerary } from '../../domain/transitRoute'
import type {
  GeoCoordinate,
  WalkingRoute,
  WalkingSpeedProfile,
} from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { calculateCoordinateGapM } from './walkingRouteDiagnostics'
import { calculateWalkingEta } from './walkingEta'

export const stationAccessComparisonPolicy = {
  endpointMaximumGapM: 30,
  similarMaximumDifferenceSeconds: 120,
} as const

export type StationAccessContextFailure =
  | 'unsupported_structure'
  | 'endpoint_unavailable'
  | 'endpoint_mismatch'

export interface StationAccessComparisonContext {
  busLegIndex: number
  postBusWalkLegIndex: number
  subwayLegIndex: number
  targetCoordinate: GeoCoordinate
  targetName: string
  endpointGapM: number
}

export type StationAccessContextResult =
  | { status: 'ready'; context: StationAccessComparisonContext }
  | { status: StationAccessContextFailure }

export type StationAccessComparisonFailure =
  | 'boarding_unavailable'
  | 'live_data_stale'
  | 'walking_estimate_unavailable'
  | 'direct_route_endpoint_mismatch'

export type StationAccessComparisonOutcome =
  | 'direct_walk_faster'
  | 'bus_faster'
  | 'similar'

export interface StationAccessComparison {
  outcome: StationAccessComparisonOutcome
  calculatedAt: string
  busDurationSeconds: number
  busArrivalAt: string
  directWalkDurationSeconds: number
  directWalkArrivalAt: string
  differenceSeconds: number
  selectedBusOrder: 1 | 2
  directWalkDistanceM: number
  kakaoProviderDurationSeconds: number
  directWalkSpeedProfile: WalkingSpeedProfile
}

export type StationAccessComparisonResult =
  | { status: 'available'; comparison: StationAccessComparison }
  | { status: StationAccessComparisonFailure }

export function findStationAccessComparisonContext(
  itinerary: TransitItinerary,
  options: { allowFollowingLegs?: boolean } = {},
): StationAccessContextResult {
  const visibleLegs = itinerary.legs
    .map((leg, legIndex) => ({ leg, legIndex }))
    .filter(({ leg }) => leg.durationSeconds > 0 || leg.distanceM > 0)

  if (
    (options.allowFollowingLegs
      ? visibleLegs.length < 4
      : visibleLegs.length !== 4) ||
    visibleLegs[0].leg.mode !== 'WALK' ||
    visibleLegs[1].leg.mode !== 'BUS' ||
    visibleLegs[2].leg.mode !== 'WALK' ||
    visibleLegs[3].leg.mode !== 'SUBWAY'
  ) {
    return { status: 'unsupported_structure' }
  }

  const postBusWalk = visibleLegs[2]
  const subway = visibleLegs[3]
  const walkEnd = postBusWalk.leg.endCoordinate
  const subwayStart = subway.leg.startCoordinate
  if (walkEnd == null || subwayStart == null) {
    return { status: 'endpoint_unavailable' }
  }

  const endpointGapM = calculateCoordinateGapM(walkEnd, subwayStart)
  if (endpointGapM > stationAccessComparisonPolicy.endpointMaximumGapM) {
    return { status: 'endpoint_mismatch' }
  }

  return {
    status: 'ready',
    context: {
      busLegIndex: visibleLegs[1].legIndex,
      postBusWalkLegIndex: postBusWalk.legIndex,
      subwayLegIndex: subway.legIndex,
      targetCoordinate: walkEnd,
      targetName: subway.leg.startName,
      endpointGapM,
    },
  }
}

export function compareStationAccessOptions(
  itinerary: TransitItinerary,
  context: StationAccessComparisonContext,
  boardingPlan: TransitBoardingPlan,
  directWalkingRoute: WalkingRoute,
  speedModel: WalkingSpeedModel | null,
): StationAccessComparisonResult {
  const directRouteEnd = directWalkingRoute.coordinates.at(-1)
  if (
    directRouteEnd === undefined ||
    calculateCoordinateGapM(
      directRouteEnd,
      context.targetCoordinate,
    ) > stationAccessComparisonPolicy.endpointMaximumGapM
  ) {
    return { status: 'direct_route_endpoint_mismatch' }
  }
  const busAssessment = boardingPlan.boardings.find(
    (item) => item.legIndex === context.busLegIndex && item.mode === 'BUS',
  )
  if (busAssessment?.dataFreshness === 'stale') {
    return { status: 'live_data_stale' }
  }
  if (
    busAssessment === undefined ||
    busAssessment.selectedOrder === null ||
    (busAssessment.status !== 'likely' && busAssessment.status !== 'tight')
  ) {
    return { status: 'boarding_unavailable' }
  }

  const selectedBus = busAssessment.candidates.find(
    (candidate) => candidate.order === busAssessment.selectedOrder,
  )
  const postBusWalk = boardingPlan.walkingLegs.find(
    (item) => item.legIndex === context.postBusWalkLegIndex,
  )
  if (selectedBus === undefined) {
    return { status: 'boarding_unavailable' }
  }
  if (postBusWalk === undefined) {
    return { status: 'walking_estimate_unavailable' }
  }

  const calculatedAt = new Date(boardingPlan.calculatedAt)
  const busLeg = itinerary.legs[context.busLegIndex]
  const busArrivalAtMs = new Date(selectedBus.serviceArrivalAt).getTime()
    + (busLeg.durationSeconds + postBusWalk.pureWalkingDurationSeconds) * 1_000
  const busDurationSeconds = Math.max(
    0,
    Math.ceil((busArrivalAtMs - calculatedAt.getTime()) / 1_000),
  )
  const directEta = calculateWalkingEta(
    directWalkingRoute.distanceM,
    directWalkingRoute.providerDurationSeconds,
    speedModel,
    calculatedAt,
  )
  const directWalkDurationSeconds = Math.ceil(directEta.appliedDurationSeconds)
  const differenceSeconds = Math.abs(
    busDurationSeconds - directWalkDurationSeconds,
  )
  const outcome = differenceSeconds <=
    stationAccessComparisonPolicy.similarMaximumDifferenceSeconds
    ? 'similar'
    : directWalkDurationSeconds < busDurationSeconds
      ? 'direct_walk_faster'
      : 'bus_faster'

  return {
    status: 'available',
    comparison: {
      outcome,
      calculatedAt: calculatedAt.toISOString(),
      busDurationSeconds,
      busArrivalAt: new Date(busArrivalAtMs).toISOString(),
      directWalkDurationSeconds,
      directWalkArrivalAt: new Date(
        calculatedAt.getTime() + directWalkDurationSeconds * 1_000,
      ).toISOString(),
      differenceSeconds,
      selectedBusOrder: busAssessment.selectedOrder,
      directWalkDistanceM: directWalkingRoute.distanceM,
      kakaoProviderDurationSeconds: directWalkingRoute.providerDurationSeconds,
      directWalkSpeedProfile: directEta.speedProfile,
    },
  }
}
