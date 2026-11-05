import type { SeoulBusProvider } from '../../../server/tago/seoulBusProvider'
import type { SeoulRouteStopArrival } from '../../domain/seoulBus'
import type {
  AutomaticTransitEgressResult,
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
import { calculateWalkingRouteEndpointGaps } from './walkingRouteDiagnostics'

const MAX_BUS_SEARCH_ANCHOR_DISTANCE_M = 120

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
): AutomaticTransitEgressResult {
  return {
    status: 'review_required',
    reason,
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
    const candidates = await findVerifiedBusCandidates(
      lastTransitStep,
      dependencies.seoulBusProvider,
      input.signal,
    )
    if (evidence.hasMultipleVehicleOptions) {
      return review('MULTIPLE_VEHICLE_OPTIONS', candidates)
    }
    if (candidates.length === 0) return review('NO_VERIFIED_BUS_STOP')
    if (candidates.length > 1) {
      return review('MULTIPLE_VERIFIED_BUS_STOPS', candidates)
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
