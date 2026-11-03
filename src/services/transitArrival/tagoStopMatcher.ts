import type {
  TagoStopCandidate,
  TagoStopMatchResult,
  TagoStopRoute,
} from '../../domain/busArrival'
import type { TransitRouteLeg, TransitStop } from '../../domain/transitRoute'
import type { GeoCoordinate } from '../../domain/walkingRoute'

const MAX_MATCH_DISTANCE_M = 120
const MAX_DIRECTION_DIFFERENCE_DEGREES = 60

export interface TagoStopMatchOptions {
  requireDirectionEvidence?: boolean
}

function toRadians(value: number): number {
  return value * Math.PI / 180
}

export function getCoordinateDistanceMeters(
  left: GeoCoordinate,
  right: GeoCoordinate,
): number {
  const earthRadiusM = 6_371_000
  const latitudeDelta = toRadians(right.latitude - left.latitude)
  const longitudeDelta = toRadians(right.longitude - left.longitude)
  const leftLatitude = toRadians(left.latitude)
  const rightLatitude = toRadians(right.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusM * Math.asin(Math.sqrt(haversine))
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^0-9a-z가-힣]/g, '')
    .replace(/정류장|정류소/g, '')
}

export function isSameStopName(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right)
}

function normalizeRouteName(value: string): string {
  const routeNumber = value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value
  return routeNumber.normalize('NFKC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '')
}

export function isSameBusRouteName(left: string, right: string): boolean {
  return normalizeRouteName(left) === normalizeRouteName(right)
}

function bearingDegrees(from: GeoCoordinate, to: GeoCoordinate): number {
  const fromLatitude = toRadians(from.latitude)
  const toLatitude = toRadians(to.latitude)
  const longitudeDelta = toRadians(to.longitude - from.longitude)
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude)
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function directionDifferenceDegrees(left: number, right: number): number {
  const difference = Math.abs(left - right)
  return Math.min(difference, 360 - difference)
}

function findBoardingStops(leg: TransitRouteLeg): {
  boarding: TransitStop
  next: TransitStop | null
} | null {
  const stops = leg.stops ?? []
  if (stops.length === 0) return null
  return { boarding: stops[0], next: stops[1] ?? null }
}

function findMatchingRoute(
  candidate: TagoStopCandidate,
  routeName: string,
): TagoStopRoute | null {
  const normalizedRouteName = normalizeRouteName(routeName)
  return candidate.routes.find(
    (route) => normalizeRouteName(route.routeName) === normalizedRouteName,
  ) ?? null
}

export function filterTagoStopCandidatesForRouteLookup(
  leg: TransitRouteLeg,
  candidates: TagoStopCandidate[],
): TagoStopCandidate[] {
  const tmapStops = findBoardingStops(leg)
  if (tmapStops === null) return []
  return candidates.filter((candidate) =>
    getCoordinateDistanceMeters(tmapStops.boarding.coordinate, candidate.coordinate) <=
      MAX_MATCH_DISTANCE_M &&
    isSameStopName(candidate.name, tmapStops.boarding.name),
  )
}

export function matchTmapBusStopToTago(
  leg: TransitRouteLeg,
  candidates: TagoStopCandidate[],
  options: TagoStopMatchOptions = {},
): TagoStopMatchResult {
  if (leg.mode !== 'BUS') {
    return { status: 'failed', reason: 'ROUTE_MISMATCH' }
  }
  const tmapStops = findBoardingStops(leg)
  if (tmapStops === null || leg.routeName === null) {
    return { status: 'failed', reason: 'NO_NEARBY_STOP' }
  }

  const nearby = candidates
    .map((candidate) => ({
      candidate,
      distanceM: getCoordinateDistanceMeters(
        tmapStops.boarding.coordinate,
        candidate.coordinate,
      ),
    }))
    .filter(({ distanceM }) => distanceM <= MAX_MATCH_DISTANCE_M)
  if (nearby.length === 0) {
    return { status: 'failed', reason: 'NO_NEARBY_STOP' }
  }

  const sameName = nearby.filter(({ candidate }) =>
    isSameStopName(candidate.name, tmapStops.boarding.name),
  )
  if (sameName.length === 0) {
    return { status: 'failed', reason: 'STOP_NAME_MISMATCH' }
  }

  const sameRoute = sameName
    .map((item) => ({
      ...item,
      route: findMatchingRoute(item.candidate, leg.routeName ?? ''),
    }))
    .filter((item): item is typeof item & { route: TagoStopRoute } => item.route !== null)
  if (sameRoute.length === 0) {
    return { status: 'failed', reason: 'ROUTE_MISMATCH' }
  }
  const hasDirectionEvidence =
    tmapStops.next !== null &&
    sameRoute.some(({ route }) => route.nextStopCoordinate !== null)
  if (hasDirectionEvidence && tmapStops.next !== null) {
    const tmapBearing = bearingDegrees(
      tmapStops.boarding.coordinate,
      tmapStops.next.coordinate,
    )
    const directionMatches = sameRoute.filter(({ candidate, route }) => {
      if (route.nextStopCoordinate === null) return false
      const tagoBearing = bearingDegrees(candidate.coordinate, route.nextStopCoordinate)
      return directionDifferenceDegrees(tmapBearing, tagoBearing) <=
        MAX_DIRECTION_DIFFERENCE_DEGREES
    })
    if (directionMatches.length === 1) {
      return {
        status: 'matched',
        candidate: directionMatches[0].candidate,
        distanceM: directionMatches[0].distanceM,
      }
    }
  } else if (
    sameRoute.length === 1 &&
    options.requireDirectionEvidence !== true
  ) {
    return {
      status: 'matched',
      candidate: sameRoute[0].candidate,
      distanceM: sameRoute[0].distanceM,
    }
  }
  // 같은 이름의 맞은편 정류장을 거리만으로 자동 선택하지 않는다.
  return { status: 'review_required', reason: 'DIRECTION_AMBIGUOUS' }
}
