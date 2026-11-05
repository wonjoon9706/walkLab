import type {
  BusArrivalInfo,
  BusArrivalRequest,
  TagoBusArrivalDiagnostics,
  TagoCityCode,
  TagoStopCandidate,
  TagoStopRoute,
} from '../../src/domain/busArrival.js'
import type { TransitRouteLeg } from '../../src/domain/transitRoute.js'
import {
  filterTagoStopCandidatesForRouteLookup,
  getCoordinateDistanceMeters,
  isSameBusRouteName,
  isSameStopName,
  matchBusStopToTago,
} from '../../src/services/transitArrival/tagoStopMatcher.js'
import { verifyTagoRouteDirection } from '../../src/services/transitArrival/tagoRouteDirection.js'
import type { TagoProvider } from './tagoProvider.js'

const MAX_ROUTE_LOOKUP_CANDIDATES = 4

interface ResolveBusArrivalOptions {
  diagnosticsEnabled?: boolean
}

function toTransitLeg(request: BusArrivalRequest): TransitRouteLeg {
  return {
    mode: 'BUS',
    distanceM: 0,
    durationSeconds: 0,
    routeName: request.routeName,
    routeId: request.routeId,
    routeColor: null,
    startName: request.boardingStop.name,
    endName: request.alightingStop.name,
    coordinates: [],
    stops: [
      {
        index: 0,
        providerStopId: request.boardingStop.providerStopId,
        name: request.boardingStop.name,
        coordinate: request.boardingStop.coordinate,
      },
      ...(request.nextStop === null
        ? []
        : [{
            index: 1,
            providerStopId: request.nextStop.providerStopId,
            name: request.nextStop.name,
            coordinate: request.nextStop.coordinate,
          }]),
    ],
  }
}

function unavailable(
  request: BusArrivalRequest,
  status: Exclude<BusArrivalInfo['status'], 'available'>,
  fetchedAt: string,
  stop: TagoStopCandidate | null = null,
): BusArrivalInfo {
  return {
    routeName: request.routeName,
    stopName: stop?.name ?? request.boardingStop.name,
    stopId: stop?.nodeId ?? null,
    arrivalSeconds: null,
    remainingStops: null,
    fetchedAt,
    provider: 'tago',
    dataMode: 'live',
    status,
    walkingTimeToStopSeconds: null,
  }
}

function attachDiagnostics(
  result: BusArrivalInfo,
  diagnostics: TagoBusArrivalDiagnostics | null,
  lastStage: TagoBusArrivalDiagnostics['lastStage'],
  outcomeReason: string,
): BusArrivalInfo {
  if (diagnostics === null) return result
  return {
    ...result,
    diagnostics: { ...diagnostics, lastStage, outcomeReason },
  }
}

export async function resolveTagoBusArrival(
  request: BusArrivalRequest,
  provider: TagoProvider,
  signal: AbortSignal,
  now: Date = new Date(),
  cityCodes?: TagoCityCode[],
  options: ResolveBusArrivalOptions = {},
): Promise<BusArrivalInfo> {
  const fetchedAt = now.toISOString()
  const leg = toTransitLeg(request)
  const [supportedCities, nearbyStops] = await Promise.all([
    cityCodes === undefined ? provider.getCityCodes(signal) : cityCodes,
    provider.getNearbyStops(request.boardingStop.coordinate, signal),
  ])

  const diagnostics: TagoBusArrivalDiagnostics | null =
    options.diagnosticsEnabled === true
      ? {
          source: 'live',
          lastStage: 'nearby_stops',
          outcomeReason: 'IN_PROGRESS',
          route: {
            routeName: request.routeName,
            boardingStopName: request.boardingStop.name,
            boardingCoordinate: request.boardingStop.coordinate,
            alightingStopName: request.alightingStop.name,
          },
          cityCodeCount: supportedCities.length,
          nearbyStopCount: nearbyStops.length,
          routeLookupCandidateCount: 0,
          candidates: nearbyStops.map((candidate) => ({
            cityCode: candidate.cityCode,
            nodeId: candidate.nodeId,
            name: candidate.name,
            distanceM: Math.round(getCoordinateDistanceMeters(
              request.boardingStop.coordinate,
              candidate.coordinate,
            ) * 10) / 10,
            nameMatched: isSameStopName(
              candidate.name,
              request.boardingStop.name,
            ),
            routeNames: [],
            directionChecks: [],
          })),
        }
      : null

  const supportedCityCodes = new Set(supportedCities.map((city) => city.code))
  const supportedStops = nearbyStops.filter((stop) =>
    supportedCityCodes.has(stop.cityCode),
  )
  if (nearbyStops.length > 0 && supportedStops.length === 0) {
    return attachDiagnostics(
      unavailable(request, 'unsupported_region', fetchedAt),
      diagnostics,
      'city_codes',
      'NEARBY_STOPS_HAVE_UNSUPPORTED_CITY_CODE',
    )
  }

  const candidates = filterTagoStopCandidatesForRouteLookup(
    leg,
    supportedStops,
  )
  if (diagnostics !== null) {
    diagnostics.routeLookupCandidateCount = candidates.length
  }
  if (candidates.length === 0) {
    const hasStopWithinDistance = diagnostics?.candidates.some(
      (candidate) => candidate.distanceM <= 120,
    ) ?? false
    return attachDiagnostics(
      unavailable(request, 'stop_match_failed', fetchedAt),
      diagnostics,
      'nearby_stops',
      nearbyStops.length === 0
        ? 'NO_NEARBY_STOPS'
        : hasStopWithinDistance
          ? 'STOP_NAME_MISMATCH'
          : 'NO_STOP_WITHIN_120M',
    )
  }
  if (candidates.length > MAX_ROUTE_LOOKUP_CANDIDATES) {
    return attachDiagnostics(
      unavailable(request, 'stop_match_review_required', fetchedAt),
      diagnostics,
      'nearby_stops',
      'TOO_MANY_STOP_CANDIDATES',
    )
  }

  for (const candidate of candidates) {
    candidate.routes = await provider.getRoutesAtStop(
      candidate.cityCode,
      candidate.nodeId,
      signal,
    )
    const candidateDiagnostic = diagnostics?.candidates.find(
      (item) => item.nodeId === candidate.nodeId,
    )
    if (candidateDiagnostic !== undefined) {
      candidateDiagnostic.routeNames = candidate.routes.map(
        (route) => route.routeName,
      )
    }
  }

  let directionNeedsReview = false
  let verifiedRouteCount = 0
  for (const candidate of candidates) {
    const matchingRoutes = candidate.routes.filter((route) =>
      isSameBusRouteName(route.routeName, request.routeName),
    )
    const verifiedRoutes: TagoStopRoute[] = []
    for (const route of matchingRoutes) {
      const routeStops = await provider.getRouteStops(
        candidate.cityCode,
        route.routeId,
        signal,
      )
      const direction = verifyTagoRouteDirection(
        route.routeId,
        candidate,
        request.boardingStop,
        request.alightingStop,
        routeStops,
      )
      const candidateDiagnostic = diagnostics?.candidates.find(
        (item) => item.nodeId === candidate.nodeId,
      )
      candidateDiagnostic?.directionChecks.push({
        routeId: route.routeId,
        routeName: route.routeName,
        routeStopCount: routeStops.length,
        status: direction.status,
        reason: direction.status === 'verified' ? null : direction.reason,
      })
      if (direction.status === 'verified') {
        verifiedRoutes.push({
          ...route,
          nextStopCoordinate: direction.nextStop.coordinate,
        })
        verifiedRouteCount += 1
      } else if (direction.status === 'review_required') {
        directionNeedsReview = true
      }
    }
    candidate.routes = verifiedRoutes
  }

  if (verifiedRouteCount === 0) {
    const matchingRouteCount = diagnostics?.candidates.reduce(
      (count, candidate) => count + candidate.directionChecks.length,
      0,
    ) ?? 0
    return attachDiagnostics(
      unavailable(
        request,
        directionNeedsReview
          ? 'stop_match_review_required'
          : 'stop_match_failed',
        fetchedAt,
      ),
      diagnostics,
      matchingRouteCount === 0 ? 'routes_at_stop' : 'direction',
      matchingRouteCount === 0
        ? 'ROUTE_NUMBER_MISMATCH'
        : directionNeedsReview
          ? 'DIRECTION_REVIEW_REQUIRED'
          : 'DIRECTION_VERIFICATION_FAILED',
    )
  }
  if (verifiedRouteCount > 1) {
    return attachDiagnostics(
      unavailable(request, 'stop_match_review_required', fetchedAt),
      diagnostics,
      'direction',
      'MULTIPLE_VERIFIED_ROUTES',
    )
  }

  const match = matchBusStopToTago(leg, candidates, {
    // 노선 경유 순서에서 검증된 다음 정류장 방향만 사용한다.
    requireDirectionEvidence: true,
  })
  if (match.status === 'review_required') {
    return attachDiagnostics(
      unavailable(request, 'stop_match_review_required', fetchedAt),
      diagnostics,
      'direction',
      match.reason,
    )
  }
  if (match.status === 'failed') {
    return attachDiagnostics(
      unavailable(request, 'stop_match_failed', fetchedAt),
      diagnostics,
      'direction',
      match.reason,
    )
  }

  const matchedRoute = match.candidate.routes.find((route) =>
    isSameBusRouteName(route.routeName, request.routeName),
  )
  if (matchedRoute === undefined) {
    return attachDiagnostics(
      unavailable(request, 'stop_match_failed', fetchedAt),
      diagnostics,
      'routes_at_stop',
      'VERIFIED_ROUTE_NOT_FOUND',
    )
  }

  const arrivals = await provider.getArrivals(
    match.candidate.cityCode,
    match.candidate.nodeId,
    signal,
  )
  const matchingArrivals = arrivals
    .filter((arrival) =>
      arrival.routeId === matchedRoute.routeId &&
      isSameBusRouteName(arrival.routeName, request.routeName),
    )
    .sort((left, right) => left.arrivalSeconds - right.arrivalSeconds)
  const arrival = matchingArrivals[0]
  if (arrival === undefined) {
    return attachDiagnostics(
      unavailable(request, 'no_service', fetchedAt, match.candidate),
      diagnostics,
      'arrivals',
      'NO_MATCHING_ARRIVAL',
    )
  }

  return attachDiagnostics({
    routeName: `${arrival.routeType} ${arrival.routeName}`.trim(),
    stopName: match.candidate.name,
    stopId: match.candidate.nodeId,
    arrivalSeconds: arrival.arrivalSeconds,
    remainingStops: arrival.remainingStops,
    fetchedAt,
    provider: 'tago',
    dataMode: 'live',
    status: 'available',
    walkingTimeToStopSeconds: null,
  }, diagnostics, 'arrivals', 'AVAILABLE')
}
