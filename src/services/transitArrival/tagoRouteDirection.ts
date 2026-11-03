import type { TagoRouteStop, TagoStopCandidate } from '../../domain/busArrival'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import {
  getCoordinateDistanceMeters,
  isSameStopName,
} from './tagoStopMatcher'

const MAX_STOP_DISTANCE_M = 120

interface TmapStopReference {
  name: string
  coordinate: GeoCoordinate
}

export type TagoRouteDirectionResult =
  | {
      status: 'verified'
      boardingStop: TagoRouteStop
      alightingStop: TagoRouteStop
      nextStop: TagoRouteStop
    }
  | {
      status: 'review_required'
      reason:
        | 'MISSING_SEQUENCE'
        | 'MISSING_COORDINATE'
        | 'DUPLICATE_SEQUENCE'
        | 'DUPLICATE_STOP'
        | 'AMBIGUOUS_BOARDING_STOP'
        | 'AMBIGUOUS_ALIGHTING_STOP'
        | 'CIRCULAR_OR_REVERSE_ORDER'
        | 'BRANCH_DIRECTION_CONFLICT'
        | 'NEXT_STOP_UNAVAILABLE'
    }
  | {
      status: 'failed'
      reason:
        | 'ROUTE_ID_MISMATCH'
        | 'BOARDING_STOP_NOT_FOUND'
        | 'ALIGHTING_STOP_NOT_FOUND'
        | 'ROUTE_STOPS_EMPTY'
    }

function matchesTmapStop(
  tagoStop: TagoRouteStop,
  tmapStop: TmapStopReference,
): boolean {
  return tagoStop.coordinate !== null &&
    isSameStopName(tagoStop.name, tmapStop.name) &&
    getCoordinateDistanceMeters(tagoStop.coordinate, tmapStop.coordinate) <=
      MAX_STOP_DISTANCE_M
}

function hasDuplicate<T>(values: T[]): boolean {
  return new Set(values).size !== values.length
}

export function verifyTagoRouteDirection(
  routeId: string,
  boardingCandidate: TagoStopCandidate,
  boardingStop: TmapStopReference,
  alightingStop: TmapStopReference,
  routeStops: TagoRouteStop[],
): TagoRouteDirectionResult {
  if (routeStops.length === 0) {
    return { status: 'failed', reason: 'ROUTE_STOPS_EMPTY' }
  }
  if (routeStops.some((stop) => stop.routeId !== routeId)) {
    return { status: 'failed', reason: 'ROUTE_ID_MISMATCH' }
  }
  if (routeStops.some((stop) => stop.sequence === null)) {
    return { status: 'review_required', reason: 'MISSING_SEQUENCE' }
  }
  if (routeStops.some((stop) => stop.coordinate === null)) {
    return { status: 'review_required', reason: 'MISSING_COORDINATE' }
  }

  const sequences = routeStops.map((stop) => stop.sequence as number)
  if (hasDuplicate(sequences)) {
    return { status: 'review_required', reason: 'DUPLICATE_SEQUENCE' }
  }
  if (hasDuplicate(routeStops.map((stop) => stop.nodeId))) {
    return { status: 'review_required', reason: 'DUPLICATE_STOP' }
  }

  const boardingMatches = routeStops.filter((stop) =>
    stop.nodeId === boardingCandidate.nodeId &&
    matchesTmapStop(stop, boardingStop),
  )
  if (boardingMatches.length === 0) {
    return { status: 'failed', reason: 'BOARDING_STOP_NOT_FOUND' }
  }
  if (boardingMatches.length > 1) {
    return { status: 'review_required', reason: 'AMBIGUOUS_BOARDING_STOP' }
  }

  const alightingMatches = routeStops.filter((stop) =>
    matchesTmapStop(stop, alightingStop),
  )
  if (alightingMatches.length === 0) {
    return { status: 'failed', reason: 'ALIGHTING_STOP_NOT_FOUND' }
  }
  if (alightingMatches.length > 1) {
    return { status: 'review_required', reason: 'AMBIGUOUS_ALIGHTING_STOP' }
  }

  const matchedBoarding = boardingMatches[0]
  const matchedAlighting = alightingMatches[0]
  const boardingSequence = matchedBoarding.sequence as number
  const alightingSequence = matchedAlighting.sequence as number
  if (boardingSequence >= alightingSequence) {
    return { status: 'review_required', reason: 'CIRCULAR_OR_REVERSE_ORDER' }
  }

  const stopsInSection = routeStops.filter((stop) => {
    const sequence = stop.sequence as number
    return sequence >= boardingSequence && sequence <= alightingSequence
  })
  const upDownCodes = stopsInSection
    .map((stop) => stop.upDownCode)
    .filter((code): code is string => code !== null)
  if (new Set(upDownCodes).size > 1) {
    return { status: 'review_required', reason: 'BRANCH_DIRECTION_CONFLICT' }
  }

  const nextStop = routeStops
    .filter((stop) => (stop.sequence as number) > boardingSequence)
    .sort((left, right) =>
      (left.sequence as number) - (right.sequence as number),
    )[0]
  if (nextStop === undefined || nextStop.coordinate === null) {
    return { status: 'review_required', reason: 'NEXT_STOP_UNAVAILABLE' }
  }

  return {
    status: 'verified',
    boardingStop: matchedBoarding,
    alightingStop: matchedAlighting,
    nextStop,
  }
}
