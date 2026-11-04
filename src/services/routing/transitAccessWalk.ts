import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type {
  TransitAccessOrigin,
  TransitAccessSpeedBasis,
  TransitAccessSpeedInput,
  TransitAccessTarget,
  TransitAccessWalkResult,
} from '../../domain/transitAccessWalk'
import type { WalkingRoute } from '../../domain/walkingRoute'
import {
  isSameBusRouteName,
  isSameStopName,
} from '../transitArrival/tagoStopMatcher'
import { isSameSubwayStationName } from '../transitArrival/seoulSubwayMatcher'
import { createKakaoTransitStepMatchingEvidence } from './kakaoTransitRouteDiagnostics'
import { selectWalkingSpeedProfile } from './walkingEta'
import { calculateWalkingRouteEndpointGaps } from './walkingRouteDiagnostics'

export const MAX_TRANSIT_WALK_ENDPOINT_GAP_M = 30

export interface BuildTransitAccessWalkInput {
  route: KakaoTransitRoute
  origin: TransitAccessOrigin
  target: TransitAccessTarget
  walkingRoute: WalkingRoute
  speed: TransitAccessSpeedInput
}

function normalizeRouteName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

function isMatchingRouteName(
  mode: TransitAccessTarget['mode'],
  actual: string,
  expected: string,
): boolean {
  if (mode === 'BUS') return isSameBusRouteName(actual, expected)
  return normalizeRouteName(actual) === normalizeRouteName(expected)
}

export function resolveTransitWalkingSpeedBasis(
  input: TransitAccessSpeedInput,
): TransitAccessSpeedBasis | null {
  if (input.kind === 'reference_only') {
    if (!Number.isFinite(input.speedMps) || input.speedMps <= 0) return null
    return {
      kind: 'reference_only',
      speedMps: input.speedMps,
      modelVersion: null,
      validSessionCount: null,
      label: input.label,
    }
  }

  const profile = selectWalkingSpeedProfile(input.model)
  return {
    kind: profile.source === 'personalized'
      ? 'g7_personalized'
      : 'g7_default_fallback',
    speedMps: profile.speedMps,
    modelVersion: profile.modelVersion,
    validSessionCount: profile.validSessionCount,
    label: null,
  }
}

export function buildTransitAccessWalk(
  input: BuildTransitAccessWalkInput,
): TransitAccessWalkResult {
  const firstTransitStep = input.route.steps.find(
    (step) => step.mode === 'BUS' || step.mode === 'SUBWAY',
  )
  if (firstTransitStep === undefined) {
    return { status: 'review_required', reason: 'NO_TRANSIT_STEP' }
  }
  if (firstTransitStep.mode !== input.target.mode) {
    return { status: 'review_required', reason: 'MODE_MISMATCH' }
  }

  const evidence = createKakaoTransitStepMatchingEvidence(firstTransitStep)
  const boardingName = evidence?.orderedStopNames[0]
  const boardingMatches = boardingName !== undefined && (
    input.target.mode === 'SUBWAY'
      ? isSameSubwayStationName(boardingName, input.target.boardingPointName)
      : isSameStopName(boardingName, input.target.boardingPointName)
  )
  if (!boardingMatches) {
    return { status: 'review_required', reason: 'BOARDING_NAME_MISMATCH' }
  }
  if (evidence === null || evidence.vehicleOptionCount === 0) {
    return { status: 'review_required', reason: 'VEHICLE_EVIDENCE_MISSING' }
  }
  if (evidence.hasMultipleVehicleOptions) {
    return { status: 'review_required', reason: 'MULTIPLE_VEHICLE_OPTIONS' }
  }
  if (!isMatchingRouteName(
    input.target.mode,
    evidence.vehicleNames[0],
    input.target.routeName,
  )) {
    return { status: 'review_required', reason: 'ROUTE_NAME_MISMATCH' }
  }

  const gaps = calculateWalkingRouteEndpointGaps(
    input.walkingRoute,
    input.origin.coordinate,
    input.target.coordinate,
  )
  if (gaps === null) {
    return { status: 'review_required', reason: 'WALKING_ROUTE_EMPTY' }
  }
  if (
    gaps.startGapM > MAX_TRANSIT_WALK_ENDPOINT_GAP_M ||
    gaps.destinationGapM > MAX_TRANSIT_WALK_ENDPOINT_GAP_M
  ) {
    return { status: 'review_required', reason: 'WALKING_ENDPOINT_MISMATCH' }
  }

  const speedBasis = resolveTransitWalkingSpeedBasis(input.speed)
  if (speedBasis === null) {
    return { status: 'review_required', reason: 'INVALID_REFERENCE_SPEED' }
  }

  return {
    status: 'ready',
    accessWalk: {
      sourceRouteId: input.route.id,
      firstTransitStepIndex: firstTransitStep.index,
      mode: input.target.mode,
      origin: input.origin,
      target: input.target,
      walkingRoute: input.walkingRoute,
      endpointGapsM: {
        start: gaps.startGapM,
        destination: gaps.destinationGapM,
      },
      endpointVerification: 'verified',
      pureWalkingDurationSeconds: Math.round(
        input.walkingRoute.distanceM / speedBasis.speedMps,
      ),
      speedBasis,
      internalStationAccess: {
        status: input.target.mode === 'SUBWAY' ? 'unknown' : 'not_applicable',
        durationSeconds: null,
      },
      providerTransitTotalDurationSeconds: input.route.totalDurationSeconds,
      personalizedTotalEtaSeconds: null,
      totalEtaStatus: 'not_calculated',
      totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED',
    },
  }
}
