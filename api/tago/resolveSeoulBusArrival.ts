import type {
  BusArrivalInfo,
  BusArrivalRequest,
} from '../../src/domain/busArrival.js'
import type {
  SeoulBusRoute,
  SeoulBusStop,
  SeoulRouteStopArrival,
} from '../../src/domain/seoulBus.js'
import {
  getCoordinateDistanceMeters,
  isSameBusRouteName,
  isSameStopName,
} from '../../src/services/transitArrival/tagoStopMatcher.js'
import type { SeoulBusProvider } from './seoulBusProvider.js'

const MAX_MATCH_DISTANCE_M = 120
const MAX_STOP_CANDIDATES = 4

export interface SeoulBusResolution {
  handled: boolean
  result: BusArrivalInfo | null
}

interface VerifiedSeoulMatch {
  boardingStop: SeoulBusStop
  route: SeoulBusRoute
  boardingArrival: SeoulRouteStopArrival
}

function unavailable(
  request: BusArrivalRequest,
  status: Exclude<BusArrivalInfo['status'], 'available'>,
  fetchedAt: string,
  stop: SeoulBusStop | null = null,
): BusArrivalInfo {
  return {
    routeName: request.routeName,
    stopName: stop?.name ?? request.boardingStop.name,
    stopId: stop?.stopId ?? null,
    arrivalSeconds: null,
    remainingStops: null,
    fetchedAt,
    provider: 'seoul',
    dataMode: 'live',
    status,
    walkingTimeToStopSeconds: null,
  }
}

function matchingStops(
  stops: SeoulBusStop[],
  reference: BusArrivalRequest['boardingStop'],
): SeoulBusStop[] {
  return stops.filter((stop) =>
    getCoordinateDistanceMeters(stop.coordinate, reference.coordinate) <=
      MAX_MATCH_DISTANCE_M &&
    isSameStopName(stop.name, reference.name),
  )
}

function routeStopOccurrences(
  stops: SeoulRouteStopArrival[],
  stop: SeoulBusStop,
  expectedName: string,
): SeoulRouteStopArrival[] {
  return stops.filter((item) =>
    item.stopId === stop.stopId &&
    isSameStopName(item.stopName, expectedName),
  )
}

export async function resolveSeoulBusArrival(
  request: BusArrivalRequest,
  provider: SeoulBusProvider,
  signal: AbortSignal,
  now: Date = new Date(),
): Promise<SeoulBusResolution> {
  const fetchedAt = now.toISOString()
  const nearbyBoardingStops = await provider.getNearbyStops(
    request.boardingStop.coordinate,
    signal,
  )
  if (nearbyBoardingStops.length === 0) {
    return { handled: false, result: null }
  }

  const boardingCandidates = matchingStops(
    nearbyBoardingStops,
    request.boardingStop,
  )
  if (boardingCandidates.length === 0) {
    const hasCloseCandidate = nearbyBoardingStops.some((stop) =>
      getCoordinateDistanceMeters(
        stop.coordinate,
        request.boardingStop.coordinate,
      ) <= MAX_MATCH_DISTANCE_M,
    )
    return {
      handled: true,
      result: unavailable(
        request,
        hasCloseCandidate
          ? 'stop_match_review_required'
          : 'stop_match_failed',
        fetchedAt,
      ),
    }
  }
  if (boardingCandidates.length > MAX_STOP_CANDIDATES) {
    return {
      handled: true,
      result: unavailable(
        request,
        'stop_match_review_required',
        fetchedAt,
      ),
    }
  }

  const nearbyAlightingStops = await provider.getNearbyStops(
    request.alightingStop.coordinate,
    signal,
  )
  const alightingCandidates = matchingStops(
    nearbyAlightingStops,
    request.alightingStop,
  )
  if (
    alightingCandidates.length === 0 ||
    alightingCandidates.length > MAX_STOP_CANDIDATES
  ) {
    return {
      handled: true,
      result: unavailable(
        request,
        'stop_match_review_required',
        fetchedAt,
      ),
    }
  }

  const routeArrivalCache = new Map<string, SeoulRouteStopArrival[]>()
  const verified: VerifiedSeoulMatch[] = []
  let matchingRouteFound = false

  for (const boardingCandidate of boardingCandidates) {
    const routes = await provider.getRoutesAtStop(
      boardingCandidate.arsId,
      signal,
    )
    const matchingRoutes = routes.filter((route) =>
      isSameBusRouteName(route.routeName, request.routeName),
    )
    if (matchingRoutes.length > 0) matchingRouteFound = true

    for (const route of matchingRoutes) {
      let routeStops = routeArrivalCache.get(route.routeId)
      if (routeStops === undefined) {
        routeStops = await provider.getRouteArrivals(route.routeId, signal)
        routeArrivalCache.set(route.routeId, routeStops)
      }
      if (routeStops.some((stop) => stop.routeId !== route.routeId)) continue

      const boardingOccurrences = routeStopOccurrences(
        routeStops,
        boardingCandidate,
        request.boardingStop.name,
      )
      if (boardingOccurrences.length !== 1) continue

      for (const alightingCandidate of alightingCandidates) {
        const alightingOccurrences = routeStopOccurrences(
          routeStops,
          alightingCandidate,
          request.alightingStop.name,
        )
        if (alightingOccurrences.length !== 1) continue
        if (
          boardingOccurrences[0].sequence >=
          alightingOccurrences[0].sequence
        ) {
          continue
        }
        verified.push({
          boardingStop: boardingCandidate,
          route,
          boardingArrival: boardingOccurrences[0],
        })
      }
    }
  }

  if (verified.length !== 1) {
    return {
      handled: true,
      result: unavailable(
        request,
        matchingRouteFound
          ? 'stop_match_review_required'
          : 'stop_match_failed',
        fetchedAt,
      ),
    }
  }

  const match = verified[0]
  const estimates = match.boardingArrival.estimates
  const firstEstimate = estimates[0]
  if (firstEstimate === undefined) {
    return {
      handled: true,
      result: unavailable(
        request,
        'no_service',
        fetchedAt,
        match.boardingStop,
      ),
    }
  }

  return {
    handled: true,
    result: {
      routeName: request.routeName.replace(':', ' '),
      stopName: match.boardingStop.name,
      stopId: match.boardingStop.stopId,
      arrivalSeconds: firstEstimate.arrivalSeconds,
      remainingStops: firstEstimate.remainingStops,
      upcomingArrivals: estimates,
      fetchedAt,
      provider: 'seoul',
      dataMode: 'live',
      status: 'available',
      walkingTimeToStopSeconds: null,
    },
  }
}
