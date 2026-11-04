import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import type { AutomaticTransitEgressResult } from '../../domain/transitEgressPoint'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { WalkingRoute, WalkingSpeedProfile } from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { selectWalkingSpeedProfile } from './walkingEta'

export type KakaoTransitEtaUnavailableReason =
  | 'NO_EXPLICIT_WALKING_STEP'
  | 'INVALID_WALKING_STEP'
  | 'INCONSISTENT_DURATION_COMPONENTS'

export interface KakaoEtaG8WalkEvidence {
  scope: 'access' | 'egress'
  walkingRoute: WalkingRoute
  endpointVerification: 'verified' | 'review_required'
  startGapM: number | null
  destinationGapM: number | null
  internalTransitTime: 'unknown' | 'not_applicable'
}

export interface KakaoEtaG8Adjustment {
  scope: 'access' | 'egress'
  application:
    | 'replaced_overlapping_explicit_walking'
    | 'provider_duration_assumed_in_total'
  walkingDistanceM: number
  providerDurationSeconds: number
  personalizedDurationSeconds: number
  adjustmentSeconds: number
  endpointVerification: 'verified' | 'review_required'
  startGapM: number | null
  destinationGapM: number | null
  internalTransitTime: 'unknown' | 'not_applicable'
  overlappingStepIndexes: number[]
}

export interface KakaoTransitEtaEstimate {
  providerDurationSeconds: number
  appliedDurationSeconds: number
  explicitWalkingStepCount: number
  explicitWalkingDistanceM: number
  providerWalkingDurationSeconds: number
  personalizedWalkingDurationSeconds: number
  stepDurationSumSeconds: number
  providerToStepDifferenceSeconds: number
  speedProfile: WalkingSpeedProfile
  g8Adjustments: KakaoEtaG8Adjustment[]
  scope: 'explicit_walking_and_available_g8'
  confidence: 'estimated'
  unverifiedWalkingOverheadSeconds: null
}

export type KakaoTransitEtaResult =
  | { status: 'available'; estimate: KakaoTransitEtaEstimate }
  | { status: 'unavailable'; reason: KakaoTransitEtaUnavailableReason }

function isUsableWalkingRoute(route: WalkingRoute | null): route is WalkingRoute {
  return route !== null &&
    Number.isFinite(route.distanceM) &&
    route.distanceM > 0 &&
    Number.isFinite(route.providerDurationSeconds) &&
    route.providerDurationSeconds > 0 &&
    route.coordinates.length >= 2 &&
    route.coordinates.every((coordinate) =>
      Number.isFinite(coordinate.latitude) &&
      coordinate.latitude >= -90 && coordinate.latitude <= 90 &&
      Number.isFinite(coordinate.longitude) &&
      coordinate.longitude >= -180 && coordinate.longitude <= 180,
    )
}

function accessEvidence(
  result: AutomaticTransitAccessResult | null,
): KakaoEtaG8WalkEvidence | null {
  if (result?.status === 'ready') {
    const walk = result.accessWalk
    if (!isUsableWalkingRoute(walk.walkingRoute)) return null
    return {
      scope: 'access', walkingRoute: walk.walkingRoute,
      endpointVerification: 'verified',
      startGapM: walk.endpointGapsM.start,
      destinationGapM: walk.endpointGapsM.destination,
      internalTransitTime: walk.internalStationAccess.status,
    }
  }
  if (
    result?.status !== 'review_required' ||
    result.detailReason !== 'WALKING_ENDPOINT_MISMATCH'
  ) return null
  const candidates = [...result.busCandidates, ...result.subwayCandidates]
    .filter((candidate) => isUsableWalkingRoute(candidate.walkingRoute))
  if (candidates.length !== 1) return null
  const candidate = candidates[0]
  if (!isUsableWalkingRoute(candidate.walkingRoute)) return null
  return {
    scope: 'access', walkingRoute: candidate.walkingRoute,
    endpointVerification: 'review_required',
    startGapM: candidate.startGapM,
    destinationGapM: candidate.destinationGapM,
    internalTransitTime: 'unknown',
  }
}

function egressEvidence(
  result: AutomaticTransitEgressResult | null,
): KakaoEtaG8WalkEvidence | null {
  if (result?.status === 'ready') {
    const walk = result.egressWalk
    if (!isUsableWalkingRoute(walk.walkingRoute)) return null
    return {
      scope: 'egress', walkingRoute: walk.walkingRoute,
      endpointVerification: 'verified',
      startGapM: walk.endpointGapsM.start,
      destinationGapM: walk.endpointGapsM.destination,
      internalTransitTime: walk.internalStationEgress.status,
    }
  }
  if (
    result?.status !== 'review_required' ||
    result.detailReason !== 'WALKING_ENDPOINT_MISMATCH'
  ) return null
  const candidates = [...result.busCandidates, ...result.subwayCandidates]
    .filter((candidate) => isUsableWalkingRoute(candidate.walkingRoute))
  if (candidates.length !== 1) return null
  const candidate = candidates[0]
  if (!isUsableWalkingRoute(candidate.walkingRoute)) return null
  return {
    scope: 'egress', walkingRoute: candidate.walkingRoute,
    endpointVerification: 'review_required',
    startGapM: candidate.startGapM,
    destinationGapM: candidate.destinationGapM,
    internalTransitTime: 'unknown',
  }
}

export function collectKakaoEtaG8WalkEvidence(
  access: AutomaticTransitAccessResult | null,
  egress: AutomaticTransitEgressResult | null,
): KakaoEtaG8WalkEvidence[] {
  return [accessEvidence(access), egressEvidence(egress)]
    .filter((evidence): evidence is KakaoEtaG8WalkEvidence => evidence !== null)
}

export function calculateKakaoTransitEta(
  route: KakaoTransitRoute,
  model: WalkingSpeedModel | null,
  g8Walks: readonly KakaoEtaG8WalkEvidence[] = [],
): KakaoTransitEtaResult {
  const walkingSteps = route.steps.filter((step) => step.mode === 'WALKING')
  if (walkingSteps.some((step) =>
    !Number.isFinite(step.distanceM) || step.distanceM <= 0 ||
    !Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0
  )) {
    return { status: 'unavailable', reason: 'INVALID_WALKING_STEP' }
  }
  const stepDurationSumSeconds = route.steps.reduce(
    (sum, step) => sum + step.durationSeconds, 0,
  )
  const providerToStepDifferenceSeconds =
    route.totalDurationSeconds - stepDurationSumSeconds
  const providerWalkingDurationSeconds = walkingSteps.reduce(
    (sum, step) => sum + step.durationSeconds, 0,
  )
  if (
    !Number.isFinite(route.totalDurationSeconds) ||
    route.totalDurationSeconds <= 0 ||
    providerToStepDifferenceSeconds < 0 ||
    providerWalkingDurationSeconds > route.totalDurationSeconds
  ) {
    return { status: 'unavailable', reason: 'INCONSISTENT_DURATION_COMPONENTS' }
  }
  const usableG8Walks = g8Walks.filter((evidence) =>
    isUsableWalkingRoute(evidence.walkingRoute),
  )
  if (walkingSteps.length === 0 && usableG8Walks.length === 0) {
    return { status: 'unavailable', reason: 'NO_EXPLICIT_WALKING_STEP' }
  }

  const speedProfile = selectWalkingSpeedProfile(model)
  const firstTransitPosition = route.steps.findIndex(
    (step) => step.mode === 'BUS' || step.mode === 'SUBWAY',
  )
  let lastTransitPosition = -1
  route.steps.forEach((step, index) => {
    if (step.mode === 'BUS' || step.mode === 'SUBWAY') {
      lastTransitPosition = index
    }
  })
  const accessWalking = firstTransitPosition < 0 ? [] : route.steps
    .slice(0, firstTransitPosition).filter((step) => step.mode === 'WALKING')
  const egressWalking = lastTransitPosition < 0 ? [] : route.steps
    .slice(lastTransitPosition + 1).filter((step) => step.mode === 'WALKING')
  const replacedStepIndexes = new Set<number>()
  const g8Adjustments: KakaoEtaG8Adjustment[] = []

  for (const evidence of usableG8Walks) {
    const overlaps = evidence.scope === 'access' ? accessWalking : egressWalking
    const personalizedDurationSeconds = Math.ceil(
      evidence.walkingRoute.distanceM / speedProfile.speedMps,
    )
    const overlappingProviderDurationSeconds = overlaps.reduce(
      (sum, step) => sum + step.durationSeconds, 0,
    )
    for (const step of overlaps) replacedStepIndexes.add(step.index)
    const providerDurationSeconds = overlaps.length > 0
      ? overlappingProviderDurationSeconds
      : evidence.walkingRoute.providerDurationSeconds
    g8Adjustments.push({
      scope: evidence.scope,
      application: overlaps.length > 0
        ? 'replaced_overlapping_explicit_walking'
        : 'provider_duration_assumed_in_total',
      walkingDistanceM: evidence.walkingRoute.distanceM,
      providerDurationSeconds,
      personalizedDurationSeconds,
      adjustmentSeconds: personalizedDurationSeconds - providerDurationSeconds,
      endpointVerification: evidence.endpointVerification,
      startGapM: evidence.startGapM,
      destinationGapM: evidence.destinationGapM,
      internalTransitTime: evidence.internalTransitTime,
      overlappingStepIndexes: overlaps.map((step) => step.index),
    })
  }

  const remainingWalkingSteps = walkingSteps.filter(
    (step) => !replacedStepIndexes.has(step.index),
  )
  const explicitWalkingDistanceM = remainingWalkingSteps.reduce(
    (sum, step) => sum + step.distanceM, 0,
  )
  const explicitProviderDurationSeconds = remainingWalkingSteps.reduce(
    (sum, step) => sum + step.durationSeconds, 0,
  )
  const explicitPersonalizedDurationSeconds = Math.ceil(
    explicitWalkingDistanceM / speedProfile.speedMps,
  )
  const g8AdjustmentSeconds = g8Adjustments.reduce(
    (sum, adjustment) => sum + adjustment.adjustmentSeconds, 0,
  )
  const explicitAdjustmentSeconds =
    explicitPersonalizedDurationSeconds - explicitProviderDurationSeconds
  const appliedDurationSeconds =
    route.totalDurationSeconds + explicitAdjustmentSeconds + g8AdjustmentSeconds
  if (!Number.isFinite(appliedDurationSeconds) || appliedDurationSeconds <= 0) {
    return { status: 'unavailable', reason: 'INCONSISTENT_DURATION_COMPONENTS' }
  }

  return {
    status: 'available',
    estimate: {
      providerDurationSeconds: route.totalDurationSeconds,
      appliedDurationSeconds,
      explicitWalkingStepCount: remainingWalkingSteps.length,
      explicitWalkingDistanceM,
      providerWalkingDurationSeconds: explicitProviderDurationSeconds,
      personalizedWalkingDurationSeconds: explicitPersonalizedDurationSeconds,
      stepDurationSumSeconds,
      providerToStepDifferenceSeconds,
      speedProfile,
      g8Adjustments,
      scope: 'explicit_walking_and_available_g8',
      confidence: 'estimated',
      unverifiedWalkingOverheadSeconds: null,
    },
  }
}
