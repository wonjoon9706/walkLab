import type { SeoulBusProvider } from '../../../server/tago/seoulBusProvider'
import type { SeoulRouteStopArrival } from '../../domain/seoulBus'
import type {
  AutomaticTransitEgressResult,
  BusEgressAmbiguity,
  BusAlightingPointCandidateEvidence,
} from '../../domain/transitEgressPoint'
import type {
  TransitEgressDestination,
  TransitEgressPoint,
} from '../../domain/transitEgressWalk'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { TransitAccessSpeedInput } from '../../domain/transitAccessWalk'
import type {
  GeoCoordinate,
  PlaceSearchResult,
  WalkingRoute,
  WalkingRouteErrorCode,
} from '../../domain/walkingRoute'
import { WalkingRouteError } from '../../domain/walkingRoute'
import {
  getCoordinateDistanceMeters,
  isSameBusRouteName,
  isSameStopName,
} from '../transitArrival/tagoStopMatcher'
import { createKakaoTransitStepMatchingEvidence } from './kakaoTransitRouteDiagnostics'
import { resolveSubwayEntranceCandidates } from './subwayEntranceResolution'
import type { SubwayEntranceWalkingRouteCache } from './subwayEntranceResolution'
import { recommendSubwayEntrance } from './subwayEntranceSelection'
import { buildTransitEgressWalk } from './transitEgressWalk'
import { MAX_TRANSIT_WALK_ENDPOINT_GAP_M } from './transitAccessWalk'
import { calculateWalkingRouteEndpointGaps } from './walkingRouteDiagnostics'
import { getTransitStopFailureDiagnostic, resolveTransitPathReferenceWalk } from './transitPathReferenceWalk'

const MAX_BUS_SEARCH_ANCHOR_DISTANCE_M = 120
// 참고 도보의 공통 위치 판별 전용이다. 정류장 확정이나 30m 스냅 기준을 대체하지 않는다.
export const MAX_EGRESS_REFERENCE_LOCATION_GAP_M = 5

export interface AutomaticTransitEgressDependencies {
  seoulBusProvider: Pick<
    SeoulBusProvider,
    'getNearbyStops' | 'getRoutesAtStop' | 'getRouteArrivals'
  >
  searchPlaces(
    query: string,
    destination: GeoCoordinate,
  ): Promise<PlaceSearchResult[]>
  getWalkingRoute(request: {
    start: GeoCoordinate
    destination: GeoCoordinate
  }): Promise<WalkingRoute>
  subwayEntranceWalkingRouteCache?: SubwayEntranceWalkingRouteCache
}

export interface ResolveAutomaticTransitEgressInput {
  route: KakaoTransitRoute
  destination: TransitEgressDestination
  speed: TransitAccessSpeedInput
  signal: AbortSignal
}

function review(
  reason: Extract<AutomaticTransitEgressResult, { status: 'review_required' }>['reason'],
  busCandidates: BusAlightingPointCandidateEvidence[] = [],
  subwayCandidates: AutomaticTransitEgressResult['subwayCandidates'] = [],
  detailReason?: Extract<AutomaticTransitEgressResult, { status: 'review_required' }>['detailReason'],
): Extract<AutomaticTransitEgressResult, { status: 'review_required' }> {
  return {
    status: 'review_required',
    reason,
    ...(reason.startsWith('MULTIPLE') ? { diagnosticCode: 'MULTIPLE_CANDIDATES' as const }
      : reason === 'WALKING_ROUTE_FAILED' ? { diagnosticCode: 'G8_REQUEST_FAILED' as const }
        : detailReason === 'WALKING_ENDPOINT_MISMATCH' ? { diagnosticCode: 'G8_SNAP_MISMATCH' as const } : {}),
    busCandidates,
    subwayCandidates,
    ...(detailReason === undefined ? {} : { detailReason }),
  }
}

function hasOrderedStopSequenceEndingAt(
  routeStops: SeoulRouteStopArrival[],
  alightingStopId: string,
  orderedStopNames: string[],
): boolean {
  const lastName = orderedStopNames.at(-1)
  if (lastName === undefined) return false
  const alightingOccurrences = routeStops.filter((stop) =>
    stop.stopId === alightingStopId && isSameStopName(stop.stopName, lastName),
  )
  if (alightingOccurrences.length !== 1) return false

  let nextSequence = alightingOccurrences[0].sequence
  for (const stopName of orderedStopNames.slice(0, -1).reverse()) {
    const earlierOccurrences = routeStops.filter((stop) =>
      stop.sequence < nextSequence && isSameStopName(stop.stopName, stopName),
    )
    if (earlierOccurrences.length !== 1) return false
    nextSequence = earlierOccurrences[0].sequence
  }
  return true
}

async function findVerifiedBusCandidates(
  step: KakaoTransitRoute['steps'][number],
  provider: AutomaticTransitEgressDependencies['seoulBusProvider'],
  signal: AbortSignal,
  diagnostics: { directionMismatch: boolean },
): Promise<BusAlightingPointCandidateEvidence[]> {
  const evidence = createKakaoTransitStepMatchingEvidence(step)
  const searchAnchor = step.coordinates.at(-1)
  const alightingName = evidence?.orderedStopNames.at(-1)
  if (evidence === null || searchAnchor === undefined || alightingName === undefined) {
    return []
  }
  const nearbyStops = await provider.getNearbyStops(searchAnchor, signal)
  const namedStops = nearbyStops.filter((stop) =>
    isSameStopName(stop.name, alightingName) &&
    getCoordinateDistanceMeters(stop.coordinate, searchAnchor) <=
      MAX_BUS_SEARCH_ANCHOR_DISTANCE_M,
  )
  const routeCache = new Map<string, SeoulRouteStopArrival[]>()
  const candidates: BusAlightingPointCandidateEvidence[] = []

  for (const stop of namedStops) {
    const routesAtStop = await provider.getRoutesAtStop(stop.arsId, signal)
    for (const vehicleName of evidence.vehicleNames) {
      const matchingRoutes = routesAtStop.filter((route) =>
        isSameBusRouteName(route.routeName, vehicleName),
      )
      for (const route of matchingRoutes) {
        let routeStops = routeCache.get(route.routeId)
        if (routeStops === undefined) {
          routeStops = await provider.getRouteArrivals(route.routeId, signal)
          routeCache.set(route.routeId, routeStops)
        }
        if (
          routeStops.some((item) => item.routeId !== route.routeId) ||
          !hasOrderedStopSequenceEndingAt(
            routeStops,
            stop.stopId,
            evidence.orderedStopNames,
          )
        ) {
          diagnostics.directionMismatch = true
          continue
        }
        candidates.push({
          stopId: stop.stopId,
          arsId: stop.arsId,
          stopName: stop.name,
          coordinate: stop.coordinate,
          routeId: route.routeId,
          routeName: route.routeName,
          distanceFromSearchAnchorM: getCoordinateDistanceMeters(
            stop.coordinate,
            searchAnchor,
          ),
          orderedStopNames: [...evidence.orderedStopNames],
          walkingRouteStatus: 'not_requested',
          walkingRoute: null,
          walkingDistanceM: null,
          walkingProviderDurationSeconds: null,
          startGapM: null,
          destinationGapM: null,
          walkingErrorCode: null,
        })
      }
    }
  }
  const unique = new Map<string, BusAlightingPointCandidateEvidence>()
  for (const candidate of candidates) {
    unique.set(`${candidate.stopId}:${candidate.routeId}`, candidate)
  }
  return [...unique.values()]
}

function getWalkingErrorCode(error: unknown): WalkingRouteErrorCode {
  return error instanceof WalkingRouteError ? error.code : 'NETWORK_ERROR'
}

async function resolveAmbiguousBusEgress(
  input: ResolveAutomaticTransitEgressInput,
  dependencies: AutomaticTransitEgressDependencies,
  step: KakaoTransitRoute['steps'][number],
  reason: 'MULTIPLE_VEHICLE_OPTIONS' | 'MULTIPLE_VERIFIED_BUS_STOPS',
  candidates: BusAlightingPointCandidateEvidence[],
): Promise<AutomaticTransitEgressResult> {
  const distinctStopCount = new Set(candidates.map((candidate) => candidate.stopId)).size
  const sameLocation = candidates.every((left) => candidates.every((right) =>
    getCoordinateDistanceMeters(left.coordinate, right.coordinate) <= MAX_EGRESS_REFERENCE_LOCATION_GAP_M,
  ))
  const endpoint = step.coordinates.at(-1)
  const commonEndpoint = endpoint !== undefined && candidates.every((candidate) =>
    getCoordinateDistanceMeters(candidate.coordinate, endpoint) <= MAX_EGRESS_REFERENCE_LOCATION_GAP_M,
  )
  const busAmbiguity: BusEgressAmbiguity = {
    vehicleOptionCount: step.vehicles.length,
    candidateCount: candidates.length,
    distinctStopCount,
    distinctRouteCount: new Set(candidates.map((candidate) => candidate.routeId)).size,
    locationRelation: candidates.length === 0 ? 'no_verified_candidates'
      : !sameLocation ? 'distinct_locations' : distinctStopCount === 1 ? 'same_stop' : 'coincident_stops',
    // 1개 step의 vehicles는 같은 stops/path에 대한 옵션이다. 후보 위치가 실제로
    // 갈라진 경우에는 원본 끝점이 있다는 사실만으로 공통 위치라 단정하지 않는다.
    referenceBasis: candidates.length <= 1 ? 'shared_step_endpoint'
      : sameLocation ? 'coincident_candidate_locations'
        : commonEndpoint ? 'common_nearby_endpoint' : 'not_established',
  }
  const result = { ...review(reason, candidates), busAmbiguity }
  if (busAmbiguity.referenceBasis === 'not_established') return result
  return { ...result,
    ...await resolveTransitPathReferenceWalk(input.route, 'egress', input.destination.coordinate,
      dependencies.getWalkingRoute, input.signal, { sharedEgressEndpoint: true }),
  }
}

export async function resolveAutomaticTransitEgress(
  input: ResolveAutomaticTransitEgressInput,
  dependencies: AutomaticTransitEgressDependencies,
): Promise<AutomaticTransitEgressResult> {
  const lastTransitStep = input.route.steps
    .filter((step) => step.mode === 'BUS' || step.mode === 'SUBWAY')
    .at(-1)
  if (lastTransitStep === undefined) return review('NO_TRANSIT_STEP')
  if (lastTransitStep.coordinates.at(-1) === undefined) {
    return review('TRANSIT_STEP_COORDINATE_MISSING')
  }
  const evidence = createKakaoTransitStepMatchingEvidence(lastTransitStep)
  if (evidence === null || evidence.orderedStopNames.length < 2) {
    return review('ALIGHTING_STOP_EVIDENCE_MISSING')
  }
  if (evidence.vehicleOptionCount === 0) {
    return review('VEHICLE_EVIDENCE_MISSING')
  }

  if (lastTransitStep.mode === 'BUS') {
    const diagnostics = { directionMismatch: false }
    let candidates: BusAlightingPointCandidateEvidence[]
    try {
      candidates = await findVerifiedBusCandidates(
        lastTransitStep,
        dependencies.seoulBusProvider,
        input.signal,
        diagnostics,
      )
    } catch (error) {
      return { ...review('NO_VERIFIED_BUS_STOP'),
        diagnosticCode: getTransitStopFailureDiagnostic(error),
        ...await resolveTransitPathReferenceWalk(input.route, 'egress', input.destination.coordinate,
          dependencies.getWalkingRoute, input.signal) }
    }
    if (evidence.hasMultipleVehicleOptions) {
      return resolveAmbiguousBusEgress(input, dependencies, lastTransitStep, 'MULTIPLE_VEHICLE_OPTIONS', candidates)
    }
    if (candidates.length === 0) return { ...review('NO_VERIFIED_BUS_STOP'),
      diagnosticCode: diagnostics.directionMismatch ? 'STOP_DIRECTION_MISMATCH' : 'STOP_CANDIDATES_EMPTY',
      ...await resolveTransitPathReferenceWalk(input.route, 'egress', input.destination.coordinate,
        dependencies.getWalkingRoute, input.signal) }
    if (candidates.length > 1) {
      return resolveAmbiguousBusEgress(input, dependencies, lastTransitStep, 'MULTIPLE_VERIFIED_BUS_STOPS', candidates)
    }
    const match = candidates[0]
    let walkingRoute: WalkingRoute
    try {
      walkingRoute = await dependencies.getWalkingRoute({
        start: match.coordinate,
        destination: input.destination.coordinate,
      })
      const gaps = calculateWalkingRouteEndpointGaps(
        walkingRoute,
        match.coordinate,
        input.destination.coordinate,
      )
      match.walkingRouteStatus = 'available'
      match.walkingRoute = walkingRoute
      match.walkingDistanceM = walkingRoute.distanceM
      match.walkingProviderDurationSeconds =
        walkingRoute.providerDurationSeconds
      match.startGapM = gaps?.startGapM ?? null
      match.destinationGapM = gaps?.destinationGapM ?? null
    } catch (error) {
      match.walkingRouteStatus = 'failed'
      match.walkingErrorCode = getWalkingErrorCode(error)
      return review('WALKING_ROUTE_FAILED', candidates)
    }
    const alightingPoint: TransitEgressPoint = {
      mode: 'BUS',
      alightingPointName: match.stopName,
      routeName: match.routeName,
      locationName: match.stopName,
      coordinate: match.coordinate,
      source: 'seoul_bus_stop',
      providerStopId: match.stopId,
      arsId: match.arsId,
      providerRouteId: match.routeId,
      verification: 'verified_bus_stop',
      directionVerification: 'route_stop_order',
    }
    const egress = buildTransitEgressWalk({
      routeId: input.route.id,
      routeTotalDurationSeconds: input.route.totalDurationSeconds,
      lastTransitStepIndex: lastTransitStep.index,
      mode: 'BUS',
      expectedAlightingName: evidence.orderedStopNames.at(-1) ?? '',
      expectedRouteName: evidence.vehicleNames[0],
      actualVehicleNames: evidence.vehicleNames,
      alightingPoint,
      destination: input.destination,
      walkingRoute,
      speed: input.speed,
    })
    return egress.status === 'ready'
      ? { status: 'ready', egressWalk: egress.egressWalk, busCandidates: candidates, subwayCandidates: [] }
      : review('EGRESS_WALK_REVIEW_REQUIRED', candidates, [], egress.reason)
  }

  if (evidence.hasMultipleVehicleOptions) {
    return review('MULTIPLE_VEHICLE_OPTIONS')
  }
  const stationName = evidence.orderedStopNames.at(-1) ?? ''
  const lineName = evidence.vehicleNames[0]
  const places = await dependencies.searchPlaces(
    `${stationName}역 ${lineName} 출구`,
    input.destination.coordinate,
  )
  const subway = await resolveSubwayEntranceCandidates({
    places,
    stationName,
    lineName,
    getWalkingRoute: dependencies.getWalkingRoute,
    createWalkingRequest: (place) => ({
      start: place.coordinate,
      destination: input.destination.coordinate,
    }),
    walkingRouteCache: dependencies.subwayEntranceWalkingRouteCache,
  })
  const recommendation = recommendSubwayEntrance(
    subway.evidence,
    subway.routes,
    input.speed,
  )
  if (recommendation === null) {
    const hadWalkingFailure = subway.evidence.some(
      (candidate) => candidate.walkingRouteStatus === 'failed',
    )
    return review(
      hadWalkingFailure ? 'WALKING_ROUTE_FAILED' : 'NO_VERIFIED_SUBWAY_EXIT',
      [],
      subway.evidence,
      subway.evidence.some((candidate) => candidate.walkingRouteStatus === 'available' &&
        candidate.stationNameMatches && candidate.lineMatches && candidate.entranceCategoryMatches &&
        candidate.closureStatus !== 'confirmed_closed' &&
        ((candidate.startGapM ?? 0) > MAX_TRANSIT_WALK_ENDPOINT_GAP_M ||
          (candidate.destinationGapM ?? 0) > MAX_TRANSIT_WALK_ENDPOINT_GAP_M))
        ? 'WALKING_ENDPOINT_MISMATCH' : undefined,
    )
  }
  const selected = recommendation.selected
  const walkingRoute = recommendation.walkingRoute
  const alightingPoint: TransitEgressPoint = {
    mode: 'SUBWAY',
    alightingPointName: stationName,
    routeName: lineName,
    locationName: selected.place.name,
    coordinate: selected.place.coordinate,
    source: 'kakao_place_subway_entrance',
    providerPlaceId: selected.place.id,
    verification: 'explicit_subway_entrance',
    categoryName: selected.place.categoryName ?? '',
    closureStatus: 'unknown',
    lineAccessStatus: 'unverified',
    selectionBasis: recommendation.selectionBasis,
    selectionConfidence: recommendation.selectionConfidence,
    internalStationTimeIncluded: recommendation.internalStationTimeIncluded,
  }
  const egress = buildTransitEgressWalk({
    routeId: input.route.id,
    routeTotalDurationSeconds: input.route.totalDurationSeconds,
    lastTransitStepIndex: lastTransitStep.index,
    mode: 'SUBWAY',
    expectedAlightingName: stationName,
    expectedRouteName: lineName,
    actualVehicleNames: evidence.vehicleNames,
    alightingPoint,
    destination: input.destination,
    walkingRoute,
    speed: input.speed,
  })
  return egress.status === 'ready'
    ? { status: 'ready', egressWalk: egress.egressWalk, busCandidates: [], subwayCandidates: subway.evidence }
    : review(
        'EGRESS_WALK_REVIEW_REQUIRED',
        [],
        subway.evidence,
        egress.reason,
      )
}
