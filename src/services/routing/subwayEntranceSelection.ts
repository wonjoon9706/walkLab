import type { SubwayEntranceCandidateEvidence } from '../../domain/transitBoardingPoint'
import type { TransitAccessSpeedInput } from '../../domain/transitAccessWalk'
import type { WalkingRoute } from '../../domain/walkingRoute'
import {
  MAX_TRANSIT_WALK_ENDPOINT_GAP_M,
  resolveTransitWalkingSpeedBasis,
} from './transitAccessWalk'

export interface SubwayEntranceRecommendation {
  selected: SubwayEntranceCandidateEvidence
  walkingRoute: WalkingRoute
  selectionBasis: 'shortest_valid_external_walk'
  selectionConfidence: 'provisional'
  internalStationTimeIncluded: false
  tieBreakRule: 'duration_then_snap_gap_then_distance_then_place_id'
}

function compareCandidates(
  left: SubwayEntranceCandidateEvidence,
  right: SubwayEntranceCandidateEvidence,
): number {
  const durationDifference =
    (left.selectionDurationSeconds ?? Number.POSITIVE_INFINITY) -
    (right.selectionDurationSeconds ?? Number.POSITIVE_INFINITY)
  if (durationDifference !== 0) return durationDifference

  const leftGap = (left.startGapM ?? Number.POSITIVE_INFINITY) +
    (left.destinationGapM ?? Number.POSITIVE_INFINITY)
  const rightGap = (right.startGapM ?? Number.POSITIVE_INFINITY) +
    (right.destinationGapM ?? Number.POSITIVE_INFINITY)
  if (leftGap !== rightGap) return leftGap - rightGap

  const distanceDifference =
    (left.walkingDistanceM ?? Number.POSITIVE_INFINITY) -
    (right.walkingDistanceM ?? Number.POSITIVE_INFINITY)
  return distanceDifference !== 0
    ? distanceDifference
    : left.place.id.localeCompare(right.place.id)
}

export function recommendSubwayEntrance(
  candidates: SubwayEntranceCandidateEvidence[],
  routes: ReadonlyMap<string, WalkingRoute>,
  speed: TransitAccessSpeedInput,
): SubwayEntranceRecommendation | null {
  const speedBasis = resolveTransitWalkingSpeedBasis(speed)
  const valid = candidates.filter((candidate) =>
    candidate.closureStatus !== 'confirmed_closed' &&
    candidate.stationNameMatches &&
    candidate.lineMatches &&
    candidate.entranceCategoryMatches &&
    candidate.walkingRouteStatus === 'available' &&
    candidate.walkingDistanceM !== null &&
    candidate.walkingProviderDurationSeconds !== null &&
    candidate.startGapM !== null &&
    candidate.startGapM <= MAX_TRANSIT_WALK_ENDPOINT_GAP_M &&
    candidate.destinationGapM !== null &&
    candidate.destinationGapM <= MAX_TRANSIT_WALK_ENDPOINT_GAP_M &&
    routes.has(candidate.place.id),
  )
  for (const candidate of valid) {
    if (speedBasis?.kind === 'g7_personalized') {
      candidate.selectionDurationSeconds = Math.round(
        (candidate.walkingDistanceM ?? 0) / speedBasis.speedMps,
      )
      candidate.selectionTimeBasis = 'g7_personalized'
    } else {
      candidate.selectionDurationSeconds =
        candidate.walkingProviderDurationSeconds
      candidate.selectionTimeBasis = 'g8_provider'
    }
  }
  valid.sort(compareCandidates)
  valid.forEach((candidate, index) => {
    candidate.selectionRank = index + 1
  })
  const selected = valid[0]
  if (selected === undefined) return null
  const walkingRoute = routes.get(selected.place.id)
  if (walkingRoute === undefined) return null

  return {
    selected,
    walkingRoute,
    selectionBasis: 'shortest_valid_external_walk',
    selectionConfidence: 'provisional',
    internalStationTimeIncluded: false,
    tieBreakRule: 'duration_then_snap_gap_then_distance_then_place_id',
  }
}
