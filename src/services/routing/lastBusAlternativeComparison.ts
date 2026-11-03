import type { TransitItinerary } from '../../domain/transitRoute'
import type {
  GeoCoordinate,
  WalkingRoute,
  WalkingSpeedProfile,
} from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { calculateTransitWalkingLeg } from './transitBoarding'
import {
  calculateCoordinateGapM,
  calculateWalkingRouteEndpointGaps,
} from './walkingRouteDiagnostics'
import { calculateWalkingEta } from './walkingEta'

export const lastBusAlternativePolicy = {
  endpointMaximumGapM: 30,
  similarMaximumDifferenceSeconds: 120,
} as const

export interface LastBusAlternativeContext {
  subwayLegIndex: number
  accessWalkLegIndex: number
  busLegIndex: number
  finalWalkLegIndex: number
  startCoordinate: GeoCoordinate
  destinationCoordinate: GeoCoordinate
  startName: string
  destinationName: string
}

export type LastBusContextResult =
  | { status: 'ready'; context: LastBusAlternativeContext }
  | {
      status:
        | 'unsupported_structure'
        | 'coordinate_unavailable'
        | 'coordinate_mismatch'
    }

export interface BusWaitEvidence {
  waitSeconds: number
  timing: 'transfer_time_verified' | 'current_time_only'
}

export type LastBusComparisonOutcome =
  | 'direct_walk_faster'
  | 'bus_faster'
  | 'similar'
  | 'bus_faster_if_wait_below_threshold'
  | 'direct_walk_faster_even_without_wait'
  | 'review_required'

export interface LastBusAlternativeComparison {
  outcome: LastBusComparisonOutcome
  directWalkDurationSeconds: number
  directWalkDistanceM: number
  kakaoProviderDurationSeconds: number
  directWalkSpeedProfile: WalkingSpeedProfile
  busAccessWalkDurationSeconds: number
  busRideDurationSeconds: number
  finalWalkDurationSeconds: number
  busBaseDurationSeconds: number
  busWaitSeconds: number | null
  breakEvenWaitSeconds: number
  directRouteValidation: 'verified' | 'review_only'
  directRouteStartGapM: number
  directRouteDestinationGapM: number
}

function isVisibleLeg(leg: TransitItinerary['legs'][number]): boolean {
  return leg.durationSeconds > 0 || leg.distanceM > 0
}

function coordinatesMatch(
  left: GeoCoordinate | null | undefined,
  right: GeoCoordinate | null | undefined,
): boolean {
  return left != null && right != null &&
    calculateCoordinateGapM(left, right) <=
      lastBusAlternativePolicy.endpointMaximumGapM
}

export function findLastBusAlternativeContext(
  itinerary: TransitItinerary,
  destinationCoordinate: GeoCoordinate,
  destinationName: string,
): LastBusContextResult {
  const visibleLegs = itinerary.legs
    .map((leg, legIndex) => ({ leg, legIndex }))
    .filter(({ leg }) => isVisibleLeg(leg))
  if (
    visibleLegs.length !== 5 ||
    visibleLegs[0].leg.mode !== 'WALK' ||
    visibleLegs[1].leg.mode !== 'SUBWAY' ||
    visibleLegs[2].leg.mode !== 'WALK' ||
    visibleLegs[3].leg.mode !== 'BUS' ||
    visibleLegs[4].leg.mode !== 'WALK'
  ) {
    return { status: 'unsupported_structure' }
  }

  const subway = visibleLegs[1]
  const accessWalk = visibleLegs[2]
  const bus = visibleLegs[3]
  const finalWalk = visibleLegs[4]
  const startCoordinate = accessWalk.leg.startCoordinate
  if (
    startCoordinate == null ||
    accessWalk.leg.endCoordinate == null ||
    bus.leg.startCoordinate == null ||
    bus.leg.endCoordinate == null ||
    finalWalk.leg.startCoordinate == null ||
    finalWalk.leg.endCoordinate == null
  ) {
    return { status: 'coordinate_unavailable' }
  }
  if (
    !coordinatesMatch(subway.leg.endCoordinate, startCoordinate) ||
    !coordinatesMatch(accessWalk.leg.endCoordinate, bus.leg.startCoordinate) ||
    !coordinatesMatch(bus.leg.endCoordinate, finalWalk.leg.startCoordinate) ||
    !coordinatesMatch(finalWalk.leg.endCoordinate, destinationCoordinate)
  ) {
    return { status: 'coordinate_mismatch' }
  }

  return {
    status: 'ready',
    context: {
      subwayLegIndex: subway.legIndex,
      accessWalkLegIndex: accessWalk.legIndex,
      busLegIndex: bus.legIndex,
      finalWalkLegIndex: finalWalk.legIndex,
      startCoordinate,
      destinationCoordinate,
      startName: accessWalk.leg.startName,
      destinationName,
    },
  }
}

export function compareLastBusWithDirectWalk(
  itinerary: TransitItinerary,
  context: LastBusAlternativeContext,
  directRoute: WalkingRoute,
  speedModel: WalkingSpeedModel | null,
  waitEvidence: BusWaitEvidence | null = null,
): LastBusAlternativeComparison {
  const accessWalk = calculateTransitWalkingLeg(
    itinerary.legs[context.accessWalkLegIndex],
    context.accessWalkLegIndex,
    speedModel,
  )
  const finalWalk = calculateTransitWalkingLeg(
    itinerary.legs[context.finalWalkLegIndex],
    context.finalWalkLegIndex,
    speedModel,
  )
  const directEta = calculateWalkingEta(
    directRoute.distanceM,
    directRoute.providerDurationSeconds,
    speedModel,
    new Date(directRoute.requestedAt),
  )
  const directWalkDurationSeconds = Math.ceil(directEta.appliedDurationSeconds)
  const busRideDurationSeconds =
    itinerary.legs[context.busLegIndex].durationSeconds
  const busBaseDurationSeconds = accessWalk.pureWalkingDurationSeconds +
    busRideDurationSeconds + finalWalk.pureWalkingDurationSeconds
  const verifiedWaitSeconds =
    waitEvidence?.timing === 'transfer_time_verified' &&
    Number.isFinite(waitEvidence.waitSeconds) &&
    waitEvidence.waitSeconds >= 0
      ? Math.ceil(waitEvidence.waitSeconds)
      : null
  const endpointGaps = calculateWalkingRouteEndpointGaps(
    directRoute,
    context.startCoordinate,
    context.destinationCoordinate,
  )
  const startGapM = endpointGaps?.startGapM ?? Number.POSITIVE_INFINITY
  const destinationGapM = endpointGaps?.destinationGapM ??
    Number.POSITIVE_INFINITY
  const directRouteValidation =
    startGapM <= lastBusAlternativePolicy.endpointMaximumGapM &&
    destinationGapM <= lastBusAlternativePolicy.endpointMaximumGapM
      ? 'verified'
      : 'review_only'
  const breakEvenWaitSeconds = directWalkDurationSeconds -
    busBaseDurationSeconds

  let outcome: LastBusComparisonOutcome
  if (directRouteValidation !== 'verified') {
    outcome = 'review_required'
  } else if (verifiedWaitSeconds === null) {
    outcome = breakEvenWaitSeconds <= 0
      ? 'direct_walk_faster_even_without_wait'
      : 'bus_faster_if_wait_below_threshold'
  } else {
    const differenceSeconds = directWalkDurationSeconds -
      (busBaseDurationSeconds + verifiedWaitSeconds)
    outcome = Math.abs(differenceSeconds) <=
      lastBusAlternativePolicy.similarMaximumDifferenceSeconds
      ? 'similar'
      : differenceSeconds > 0
        ? 'bus_faster'
        : 'direct_walk_faster'
  }

  return {
    outcome,
    directWalkDurationSeconds,
    directWalkDistanceM: directRoute.distanceM,
    kakaoProviderDurationSeconds: directRoute.providerDurationSeconds,
    directWalkSpeedProfile: directEta.speedProfile,
    busAccessWalkDurationSeconds: accessWalk.pureWalkingDurationSeconds,
    busRideDurationSeconds,
    finalWalkDurationSeconds: finalWalk.pureWalkingDurationSeconds,
    busBaseDurationSeconds,
    busWaitSeconds: verifiedWaitSeconds,
    breakEvenWaitSeconds,
    directRouteValidation,
    directRouteStartGapM: startGapM,
    directRouteDestinationGapM: destinationGapM,
  }
}
