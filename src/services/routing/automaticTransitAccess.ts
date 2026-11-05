import type { SeoulBusProvider } from '../../../server/tago/seoulBusProvider'
import type { SeoulRouteStopArrival } from '../../domain/seoulBus'
import type {
  AutomaticTransitAccessResult,
  BusBoardingResolutionDiagnostics,
  BusBoardingPointCandidateEvidence,
  BusBoardingStopDiagnostic,
  SubwayEntranceCandidateEvidence,
} from '../../domain/transitBoardingPoint'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type {
  TransitAccessOrigin,
  TransitAccessSpeedInput,
  TransitAccessTarget,
} from '../../domain/transitAccessWalk'
import type {
  GeoCoordinate,
  PlaceSearchResult,
  WalkingRoute,
} from '../../domain/walkingRoute'
import {
  getCoordinateDistanceMeters,
  isSameBusRouteName,
  isSameStopName,
} from '../transitArrival/tagoStopMatcher'
import { createKakaoTransitStepMatchingEvidence } from './kakaoTransitRouteDiagnostics'
import {
  buildTransitAccessWalk,
  MAX_TRANSIT_WALK_ENDPOINT_GAP_M,
} from './transitAccessWalk'
import { resolveSubwayEntranceCandidates } from './subwayEntranceResolution'
import type { SubwayEntranceWalkingRouteCache } from './subwayEntranceResolution'
import { recommendSubwayEntrance } from './subwayEntranceSelection'
import { calculateWalkingRouteEndpointGaps } from './walkingRouteDiagnostics'
import { getTransitStopFailureCode, getTransitStopFailureDiagnostic, resolveTransitPathReferenceWalk } from './transitPathReferenceWalk'

const MAX_BUS_SEARCH_ANCHOR_DISTANCE_M = 120

export interface AutomaticTransitAccessDependencies {
  seoulBusProvider: Pick<
    SeoulBusProvider,
    'getNearbyStops' | 'getRoutesAtStop' | 'getRouteArrivals'
  >
  searchPlaces(
    query: string,
    origin: GeoCoordinate,
  ): Promise<PlaceSearchResult[]>
  getWalkingRoute(request: {
    start: GeoCoordinate
    destination: GeoCoordinate
  }): Promise<WalkingRoute>
  subwayEntranceWalkingRouteCache?: SubwayEntranceWalkingRouteCache
}

export interface ResolveAutomaticTransitAccessInput {
  route: KakaoTransitRoute
  origin: TransitAccessOrigin
  speed: TransitAccessSpeedInput
  signal: AbortSignal
}

function review(
  reason: Extract<AutomaticTransitAccessResult, { status: 'review_required' }>['reason'],
  busCandidates: BusBoardingPointCandidateEvidence[] = [],
  subwayCandidates: SubwayEntranceCandidateEvidence[] = [],
  detailReason?: Extract<AutomaticTransitAccessResult, { status: 'review_required' }>['detailReason'],
  busDiagnostics: BusBoardingResolutionDiagnostics | null = null,
): Extract<AutomaticTransitAccessResult, { status: 'review_required' }> {
  return {
    status: 'review_required',
    reason,
    ...(reason.startsWith('MULTIPLE') ? { diagnosticCode: 'MULTIPLE_CANDIDATES' as const }
      : reason === 'WALKING_ROUTE_FAILED' ? { diagnosticCode: 'G8_REQUEST_FAILED' as const }
        : detailReason === 'WALKING_ENDPOINT_MISMATCH' ? { diagnosticCode: 'G8_SNAP_MISMATCH' as const } : {}),
    busCandidates,
    busDiagnostics,
    subwayCandidates,
    ...(detailReason === undefined ? {} : { detailReason }),
  }
}

export function hasOrderedStopSequence(
  routeStops: SeoulRouteStopArrival[],
  boardingStopId: string,
  orderedStopNames: string[],
): boolean {
  const boardingOccurrences = routeStops.filter((stop) =>
    stop.stopId === boardingStopId &&
    isSameStopName(stop.stopName, orderedStopNames[0]),
  )
  if (boardingOccurrences.length !== 1) return false

  let previousSequence = boardingOccurrences[0].sequence
  for (const stopName of orderedStopNames.slice(1)) {
    const nextOccurrences = routeStops.filter((stop) =>
      stop.sequence === previousSequence + 1 &&
      isSameStopName(stop.stopName, stopName),
    )
    if (nextOccurrences.length !== 1) return false
    previousSequence = nextOccurrences[0].sequence
  }
  return true
}

async function findVerifiedBusCandidates(
  route: KakaoTransitRoute,
  provider: AutomaticTransitAccessDependencies['seoulBusProvider'],
  signal: AbortSignal,
): Promise<{
  candidates: BusBoardingPointCandidateEvidence[]
  diagnostics: BusBoardingResolutionDiagnostics | null
}> {
  const step = route.steps.find((item) => item.mode === 'BUS')
  if (step === undefined) return { candidates: [], diagnostics: null }
  const matchingEvidence = createKakaoTransitStepMatchingEvidence(step)
  const searchAnchor = step.coordinates[0]
  if (matchingEvidence === null || searchAnchor === undefined) {
    return { candidates: [], diagnostics: null }
  }

  const nearbyStops = await provider.getNearbyStops(searchAnchor, signal)
  const stopDiagnostics: BusBoardingStopDiagnostic[] = nearbyStops.map((stop) => {
    const distance = getCoordinateDistanceMeters(stop.coordinate, searchAnchor)
    const nameMatched = isSameStopName(
      stop.name,
      matchingEvidence.orderedStopNames[0],
    )
    const withinSearchDistance = distance <= MAX_BUS_SEARCH_ANCHOR_DISTANCE_M
    return {
      stopId: stop.stopId,
      arsId: stop.arsId,
      stopName: stop.name,
      distanceFromSearchAnchorM: distance,
      nameMatched,
      withinSearchDistance,
      routeMatches: [],
      outcome: !nameMatched
        ? 'NAME_MISMATCH'
        : !withinSearchDistance
          ? 'DISTANCE_EXCEEDED'
          : 'ROUTE_MISMATCH',
    }
  })
  const diagnosticByStopId = new Map(
    stopDiagnostics.map((diagnostic) => [diagnostic.stopId, diagnostic]),
  )
  const namedStops = nearbyStops.filter((stop) => {
    const diagnostic = diagnosticByStopId.get(stop.stopId)
    return diagnostic?.nameMatched === true &&
      diagnostic.withinSearchDistance
  })
  const arrivalCache = new Map<string, SeoulRouteStopArrival[]>()
  const candidates: BusBoardingPointCandidateEvidence[] = []

  for (const stop of namedStops) {
    const stopDiagnostic = diagnosticByStopId.get(stop.stopId)
    const routesAtStop = await provider.getRoutesAtStop(stop.arsId, signal)
    for (const vehicleName of matchingEvidence.vehicleNames) {
      const matchingRoutes = routesAtStop.filter((item) =>
        isSameBusRouteName(item.routeName, vehicleName),
      )
      for (const matchingRoute of matchingRoutes) {
        let routeStops = arrivalCache.get(matchingRoute.routeId)
        if (routeStops === undefined) {
          routeStops = await provider.getRouteArrivals(
            matchingRoute.routeId,
            signal,
          )
          arrivalCache.set(matchingRoute.routeId, routeStops)
        }
        const routeIdMatches = routeStops.every(
          (item) => item.routeId === matchingRoute.routeId,
        )
        const directionVerified = routeIdMatches && hasOrderedStopSequence(
            routeStops,
            stop.stopId,
            matchingEvidence.orderedStopNames,
          )
        stopDiagnostic?.routeMatches.push({
          routeId: matchingRoute.routeId,
          routeName: matchingRoute.routeName,
          directionVerified,
          reason: !routeIdMatches
            ? 'ROUTE_STOP_ID_MISMATCH'
            : directionVerified
              ? 'VERIFIED'
              : 'STOP_ORDER_MISMATCH',
        })
        if (!directionVerified) {
          if (stopDiagnostic !== undefined) {
            stopDiagnostic.outcome = 'DIRECTION_MISMATCH'
          }
          continue
        }
        if (stopDiagnostic !== undefined) stopDiagnostic.outcome = 'VERIFIED'
        const boardingArrival = routeStops.find((item) =>
          item.stopId === stop.stopId &&
          isSameStopName(item.stopName, matchingEvidence.orderedStopNames[0]),
        )
        candidates.push({
          stopId: stop.stopId,
          arsId: stop.arsId,
          stopName: stop.name,
          coordinate: stop.coordinate,
          routeId: matchingRoute.routeId,
          routeName: matchingRoute.routeName,
          distanceFromSearchAnchorM: getCoordinateDistanceMeters(
            stop.coordinate,
            searchAnchor,
          ),
          orderedStopNames: [...matchingEvidence.orderedStopNames],
          walkingRouteStatus: 'not_requested',
          walkingRoute: null,
          walkingDistanceM: null,
          walkingProviderDurationSeconds: null,
          startGapM: null,
          destinationGapM: null,
          walkingErrorCode: null,
          arrivalEstimates: boardingArrival?.estimates ?? [],
          arrivalFetchedAt: boardingArrival?.fetchedAt ?? new Date().toISOString(),
        })
      }
    }
  }

  const unique = new Map<string, BusBoardingPointCandidateEvidence>()
  for (const candidate of candidates) {
    unique.set(`${candidate.stopId}:${candidate.routeId}`, candidate)
  }
  return {
    candidates: [...unique.values()],
    diagnostics: {
      searchAnchorSource: 'kakao_bus_path_first_coordinate',
      searchRadiusM: MAX_BUS_SEARCH_ANCHOR_DISTANCE_M,
      nearbyStopCount: nearbyStops.length,
      expectedStopName: matchingEvidence.orderedStopNames[0],
      vehicleNames: [...matchingEvidence.vehicleNames],
      orderedStopNames: [...matchingEvidence.orderedStopNames],
      candidates: stopDiagnostics,
    },
  }
}

export async function resolveAutomaticTransitAccess(
  input: ResolveAutomaticTransitAccessInput,
  dependencies: AutomaticTransitAccessDependencies,
): Promise<AutomaticTransitAccessResult> {
  const firstTransitStep = input.route.steps.find(
    (step) => step.mode === 'BUS' || step.mode === 'SUBWAY',
  )
  if (firstTransitStep === undefined) return review('NO_TRANSIT_STEP')
  const evidence = createKakaoTransitStepMatchingEvidence(firstTransitStep)
  if (firstTransitStep.coordinates[0] === undefined) {
    return review('TRANSIT_STEP_COORDINATE_MISSING')
  }
  if (evidence === null || evidence.orderedStopNames.length < 2) {
    return review('BOARDING_STOP_EVIDENCE_MISSING')
  }
  if (evidence.vehicleOptionCount === 0) {
    return review('VEHICLE_EVIDENCE_MISSING')
  }

  if (firstTransitStep.mode === 'BUS') {
    let busResolution: Awaited<ReturnType<typeof findVerifiedBusCandidates>>
    try {
      busResolution = await findVerifiedBusCandidates(
        input.route,
        dependencies.seoulBusProvider,
        input.signal,
      )
    } catch (error) {
      return { ...review('NO_VERIFIED_BUS_STOP'),
        diagnosticCode: getTransitStopFailureDiagnostic(error),
        busLookupErrorCode: getTransitStopFailureCode(error),
        ...await resolveTransitPathReferenceWalk(input.route, 'access', input.origin.coordinate,
          dependencies.getWalkingRoute, input.signal) }
    }
    const candidates = busResolution.candidates
    if (evidence.hasMultipleVehicleOptions) {
      return review(
        'MULTIPLE_VEHICLE_OPTIONS',
        candidates,
        [],
        undefined,
        busResolution.diagnostics,
      )
    }
    if (candidates.length === 0) {
      return { ...review(
        'NO_VERIFIED_BUS_STOP',
        [],
        [],
        undefined,
        busResolution.diagnostics,
      ), diagnosticCode: busResolution.diagnostics?.candidates.some((item) => item.outcome === 'DIRECTION_MISMATCH')
        ? 'STOP_DIRECTION_MISMATCH' : 'STOP_CANDIDATES_EMPTY',
        ...await resolveTransitPathReferenceWalk(input.route, 'access', input.origin.coordinate,
          dependencies.getWalkingRoute, input.signal) }
    }
    if (candidates.length > 1) {
      return review(
        'MULTIPLE_VERIFIED_BUS_STOPS',
        candidates,
        [],
        undefined,
        busResolution.diagnostics,
      )
    }

    const match = candidates[0]
    let walkingRoute: WalkingRoute
    try {
      walkingRoute = await dependencies.getWalkingRoute({
        start: input.origin.coordinate,
        destination: match.coordinate,
      })
      const gaps = calculateWalkingRouteEndpointGaps(
        walkingRoute,
        input.origin.coordinate,
        match.coordinate,
      )
      match.walkingRouteStatus = 'available'
      match.walkingRoute = walkingRoute
      match.walkingDistanceM = walkingRoute.distanceM
      match.walkingProviderDurationSeconds = walkingRoute.providerDurationSeconds
      match.startGapM = gaps?.startGapM ?? null
      match.destinationGapM = gaps?.destinationGapM ?? null
    } catch {
      match.walkingRouteStatus = 'failed'
      return review(
        'WALKING_ROUTE_FAILED',
        candidates,
        [],
        undefined,
        busResolution.diagnostics,
      )
    }
    const target: TransitAccessTarget = {
      mode: 'BUS',
      boardingPointName: match.stopName,
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
    const access = buildTransitAccessWalk({
      route: input.route,
      origin: input.origin,
      target,
      walkingRoute,
      speed: input.speed,
    })
    return access.status === 'ready'
      ? {
          status: 'ready',
          accessWalk: access.accessWalk,
          busCandidates: candidates,
          busDiagnostics: busResolution.diagnostics,
          subwayCandidates: [],
        }
      : review(
          'ACCESS_WALK_REVIEW_REQUIRED',
          candidates,
          [],
          access.reason,
          busResolution.diagnostics,
        )
  }

  const stationName = evidence.orderedStopNames[0]
  const lineName = evidence.vehicleNames[0]
  if (evidence.hasMultipleVehicleOptions) {
    return review('MULTIPLE_VEHICLE_OPTIONS')
  }
  const places = await dependencies.searchPlaces(
    `${stationName}역 ${lineName} 출구`,
    input.origin.coordinate,
  )
  const subway = await resolveSubwayEntranceCandidates({
    places,
    stationName,
    lineName,
    getWalkingRoute: dependencies.getWalkingRoute,
    createWalkingRequest: (place) => ({
      start: input.origin.coordinate,
      destination: place.coordinate,
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
    const matchedAvailable = subway.evidence.filter((candidate) =>
      candidate.closureStatus !== 'confirmed_closed' &&
      candidate.stationNameMatches &&
      candidate.lineMatches &&
      candidate.entranceCategoryMatches &&
      candidate.walkingRouteStatus === 'available',
    )
    const hasStartMismatch = matchedAvailable.some((candidate) =>
      candidate.startGapM !== null &&
      candidate.startGapM > MAX_TRANSIT_WALK_ENDPOINT_GAP_M,
    )
    const hasDestinationMismatch = matchedAvailable.some((candidate) =>
      candidate.destinationGapM !== null &&
      candidate.destinationGapM > MAX_TRANSIT_WALK_ENDPOINT_GAP_M,
    )
    const snapReason = hasStartMismatch && hasDestinationMismatch
      ? 'ACCESS_WALK_ENDPOINT_SNAP_MISMATCH'
      : hasStartMismatch
        ? 'ACCESS_WALK_START_SNAP_MISMATCH'
        : hasDestinationMismatch
          ? 'ACCESS_WALK_DESTINATION_SNAP_MISMATCH'
          : null
    return review(
      snapReason ?? (
        hadWalkingFailure
          ? 'WALKING_ROUTE_FAILED'
          : 'NO_VERIFIED_SUBWAY_ENTRANCE'
      ),
      [],
      subway.evidence,
      snapReason === null ? undefined : 'WALKING_ENDPOINT_MISMATCH',
    )
  }
  const selected = recommendation.selected
  const walkingRoute = recommendation.walkingRoute
  const target: TransitAccessTarget = {
    mode: 'SUBWAY',
    boardingPointName: stationName,
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
  const access = buildTransitAccessWalk({
    route: input.route,
    origin: input.origin,
    target,
    walkingRoute,
    speed: input.speed,
  })
  return access.status === 'ready'
    ? {
        status: 'ready',
        accessWalk: access.accessWalk,
        busCandidates: [],
        busDiagnostics: null,
        subwayCandidates: subway.evidence,
      }
    : review(
        'ACCESS_WALK_REVIEW_REQUIRED',
        [],
        subway.evidence,
        access.reason,
      )
}
