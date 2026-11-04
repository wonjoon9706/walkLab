import type {
  BuildTransitEgressWalkInput,
  TransitEgressWalkResult,
} from '../../domain/transitEgressWalk'
import {
  isSameBusRouteName,
  isSameStopName,
} from '../transitArrival/tagoStopMatcher'
import { isSameSubwayStationName } from '../transitArrival/seoulSubwayMatcher'
import {
  MAX_TRANSIT_WALK_ENDPOINT_GAP_M,
  resolveTransitWalkingSpeedBasis,
} from './transitAccessWalk'
import { calculateWalkingRouteEndpointGaps } from './walkingRouteDiagnostics'

function normalizeRouteName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

export function buildTransitEgressWalk(
  input: BuildTransitEgressWalkInput,
): TransitEgressWalkResult {
  if (input.mode !== input.alightingPoint.mode) {
    return { status: 'review_required', reason: 'MODE_MISMATCH' }
  }
  const alightingNameMatches = input.mode === 'BUS'
    ? isSameStopName(
        input.expectedAlightingName,
        input.alightingPoint.alightingPointName,
      )
    : isSameSubwayStationName(
        input.expectedAlightingName,
        input.alightingPoint.alightingPointName,
      )
  if (!alightingNameMatches) {
    return { status: 'review_required', reason: 'ALIGHTING_NAME_MISMATCH' }
  }
  if (input.actualVehicleNames.length === 0) {
    return { status: 'review_required', reason: 'VEHICLE_EVIDENCE_MISSING' }
  }
  if (input.actualVehicleNames.length > 1) {
    return { status: 'review_required', reason: 'MULTIPLE_VEHICLE_OPTIONS' }
  }
  const routeNameMatches = input.mode === 'BUS'
    ? isSameBusRouteName(
        input.actualVehicleNames[0],
        input.expectedRouteName,
      )
    : normalizeRouteName(input.actualVehicleNames[0]) ===
      normalizeRouteName(input.expectedRouteName)
  if (!routeNameMatches) {
    return { status: 'review_required', reason: 'ROUTE_NAME_MISMATCH' }
  }

  const gaps = calculateWalkingRouteEndpointGaps(
    input.walkingRoute,
    input.alightingPoint.coordinate,
    input.destination.coordinate,
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
    egressWalk: {
      sourceRouteId: input.routeId,
      lastTransitStepIndex: input.lastTransitStepIndex,
      mode: input.mode,
      alightingPoint: input.alightingPoint,
      destination: input.destination,
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
      internalStationEgress: {
        status: input.mode === 'SUBWAY' ? 'unknown' : 'not_applicable',
        durationSeconds: null,
      },
      providerTransitTotalDurationSeconds: input.routeTotalDurationSeconds,
      personalizedTotalEtaSeconds: null,
      totalEtaStatus: 'not_calculated',
      totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED',
    },
  }
}
