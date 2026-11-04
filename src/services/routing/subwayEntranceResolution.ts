import type { SubwayEntranceCandidateEvidence } from '../../domain/transitBoardingPoint'
import type {
  GeoCoordinate,
  PlaceSearchResult,
  WalkingRoute,
  WalkingRouteErrorCode,
} from '../../domain/walkingRoute'
import { WalkingRouteError } from '../../domain/walkingRoute'
import { isSameSubwayStationName } from '../transitArrival/seoulSubwayMatcher'
import {
  calculateCoordinateGapM,
  calculateWalkingRouteEndpointGaps,
} from './walkingRouteDiagnostics'

export const MAX_SUBWAY_ENTRANCE_G8_CANDIDATES = 5

export interface SubwayEntranceWalkingRequest {
  start: GeoCoordinate
  destination: GeoCoordinate
}

export interface ResolveSubwayEntranceCandidatesInput {
  places: PlaceSearchResult[]
  stationName: string
  lineName: string
  getWalkingRoute(request: SubwayEntranceWalkingRequest): Promise<WalkingRoute>
  createWalkingRequest(place: PlaceSearchResult): SubwayEntranceWalkingRequest
  walkingRouteCache?: SubwayEntranceWalkingRouteCache
}

export type SubwayEntranceWalkingRouteCache = Map<string, Promise<WalkingRoute>>

export function createSubwayEntranceWalkingRouteCache(): SubwayEntranceWalkingRouteCache {
  return new Map<string, Promise<WalkingRoute>>()
}

function createWalkingRequestCacheKey(
  request: SubwayEntranceWalkingRequest,
): string {
  return [
    request.start.latitude,
    request.start.longitude,
    request.destination.latitude,
    request.destination.longitude,
  ].join(':')
}

function normalizeLineName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

function readStationName(placeName: string): string | null {
  const stationEnd = placeName.indexOf('역')
  if (stationEnd <= 0) return null
  return placeName.slice(0, stationEnd)
}

function isConfirmedClosed(place: PlaceSearchResult): boolean {
  const text = `${place.name} ${place.categoryName ?? ''}`
  return /(?:임시)?폐쇄|운영중단|사용중지/u.test(text)
}

function createCandidate(
  place: PlaceSearchResult,
  stationName: string,
  lineName: string,
): SubwayEntranceCandidateEvidence {
  const candidateStationName = readStationName(place.name)
  const searchableText = normalizeLineName(
    `${place.name} ${place.categoryName ?? ''}`,
  )
  return {
    place,
    closureStatus: isConfirmedClosed(place)
      ? 'confirmed_closed'
      : 'unknown',
    stationNameMatches: candidateStationName !== null &&
      isSameSubwayStationName(candidateStationName, stationName),
    lineMatches: searchableText.includes(normalizeLineName(lineName)),
    entranceCategoryMatches:
      place.categoryName?.includes('지하철출구') === true,
    walkingRouteStatus: 'not_requested',
    walkingRoute: null,
    prefilterStatus: 'ineligible',
    straightDistanceM: null,
    walkingDistanceM: null,
    walkingProviderDurationSeconds: null,
    startGapM: null,
    destinationGapM: null,
    walkingErrorCode: null,
    selectionDurationSeconds: null,
    selectionTimeBasis: null,
    selectionRank: null,
  }
}

function getWalkingErrorCode(error: unknown): WalkingRouteErrorCode {
  return error instanceof WalkingRouteError ? error.code : 'NETWORK_ERROR'
}

export async function resolveSubwayEntranceCandidates(
  input: ResolveSubwayEntranceCandidatesInput,
): Promise<{
  evidence: SubwayEntranceCandidateEvidence[]
  routes: Map<string, WalkingRoute>
}> {
  const evidence = input.places.map((place) =>
    createCandidate(place, input.stationName, input.lineName),
  )
  const eligible = evidence.filter((candidate) =>
    candidate.closureStatus !== 'confirmed_closed' &&
    candidate.stationNameMatches &&
    candidate.lineMatches &&
    candidate.entranceCategoryMatches,
  )
  const routes = new Map<string, WalkingRoute>()
  const walkingRouteCache = input.walkingRouteCache ??
    createSubwayEntranceWalkingRouteCache()

  for (const candidate of eligible) {
    const request = input.createWalkingRequest(candidate.place)
    candidate.straightDistanceM = calculateCoordinateGapM(
      request.start,
      request.destination,
    )
  }
  const selectedForG8 = [...eligible]
    .sort((left, right) => {
      const distanceDifference =
        (left.straightDistanceM ?? Number.POSITIVE_INFINITY) -
        (right.straightDistanceM ?? Number.POSITIVE_INFINITY)
      return distanceDifference !== 0
        ? distanceDifference
        : left.place.id.localeCompare(right.place.id)
    })
    .slice(0, MAX_SUBWAY_ENTRANCE_G8_CANDIDATES)
  const selectedIds = new Set(selectedForG8.map((candidate) => candidate.place.id))
  for (const candidate of eligible) {
    candidate.prefilterStatus = selectedIds.has(candidate.place.id)
      ? 'selected_for_g8'
      : 'skipped_by_limit'
  }

  await Promise.all(selectedForG8.map(async (candidate) => {
    const request = input.createWalkingRequest(candidate.place)
    const cacheKey = createWalkingRequestCacheKey(request)
    let walkingPromise = walkingRouteCache.get(cacheKey)
    if (walkingPromise === undefined) {
      walkingPromise = input.getWalkingRoute(request)
      walkingRouteCache.set(cacheKey, walkingPromise)
    }
    try {
      const walkingRoute = await walkingPromise
      const gaps = calculateWalkingRouteEndpointGaps(
        walkingRoute,
        request.start,
        request.destination,
      )
      candidate.walkingRouteStatus = 'available'
      candidate.walkingRoute = walkingRoute
      candidate.walkingDistanceM = walkingRoute.distanceM
      candidate.walkingProviderDurationSeconds =
        walkingRoute.providerDurationSeconds
      candidate.startGapM = gaps?.startGapM ?? null
      candidate.destinationGapM = gaps?.destinationGapM ?? null
      routes.set(candidate.place.id, walkingRoute)
    } catch (error) {
      if (walkingRouteCache.get(cacheKey) === walkingPromise) {
        walkingRouteCache.delete(cacheKey)
      }
      candidate.walkingRouteStatus = 'failed'
      candidate.walkingErrorCode = getWalkingErrorCode(error)
    }
  }))
  return { evidence, routes }
}
