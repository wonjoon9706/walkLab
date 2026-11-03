import type {
  TransitItinerary,
  TransitMode,
  TransitRouteLeg,
  TransitRouteResult,
} from '../../domain/transitRoute.js'
import { TransitRouteError } from '../../domain/transitRoute.js'
import type { GeoCoordinate } from '../../domain/walkingRoute.js'

const TRANSIT_MODES = new Set<TransitMode>([
  'WALK',
  'BUS',
  'SUBWAY',
  'EXPRESSBUS',
  'TRAIN',
  'AIRPLANE',
  'FERRY',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function readNonNegativeNumber(value: unknown): number | null {
  const parsed = readFiniteNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function parseCoordinate(longitudeValue: unknown, latitudeValue: unknown) {
  const longitude = readFiniteNumber(longitudeValue)
  const latitude = readFiniteNumber(latitudeValue)
  if (
    longitude === null ||
    latitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null
  }
  return { latitude, longitude }
}

function parseLineString(value: unknown): GeoCoordinate[] {
  if (typeof value !== 'string') return []
  const coordinates: GeoCoordinate[] = []
  for (const pair of value.trim().split(/\s+/)) {
    const [longitude, latitude] = pair.split(',')
    const coordinate = parseCoordinate(longitude, latitude)
    if (coordinate === null) continue
    const previous = coordinates.at(-1)
    if (
      previous?.latitude === coordinate.latitude &&
      previous.longitude === coordinate.longitude
    ) {
      continue
    }
    coordinates.push(coordinate)
  }
  return coordinates
}

function appendCoordinates(
  target: GeoCoordinate[],
  source: GeoCoordinate[],
): void {
  for (const coordinate of source) {
    const previous = target.at(-1)
    if (
      previous?.latitude === coordinate.latitude &&
      previous.longitude === coordinate.longitude
    ) {
      continue
    }
    target.push(coordinate)
  }
}

function parseLegCoordinates(leg: Record<string, unknown>): GeoCoordinate[] {
  const coordinates: GeoCoordinate[] = []
  if (Array.isArray(leg.steps)) {
    for (const step of leg.steps) {
      if (!isRecord(step)) continue
      appendCoordinates(coordinates, parseLineString(step.linestring))
    }
  }
  if (isRecord(leg.passShape)) {
    appendCoordinates(
      coordinates,
      parseLineString(leg.passShape.linestring),
    )
  }
  return coordinates
}

function readLocationName(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.name === 'string'
    ? value.name
    : fallback
}

function parseLeg(value: unknown): TransitRouteLeg | null {
  if (!isRecord(value) || !TRANSIT_MODES.has(value.mode as TransitMode)) {
    return null
  }
  const distanceM = readNonNegativeNumber(value.distance)
  const durationSeconds = readNonNegativeNumber(value.sectionTime)
  if (distanceM === null || durationSeconds === null) return null

  return {
    mode: value.mode as TransitMode,
    distanceM,
    durationSeconds,
    routeName: typeof value.route === 'string' ? value.route : null,
    routeColor:
      typeof value.routeColor === 'string' ? value.routeColor : null,
    startName: readLocationName(value.start, '출발지'),
    endName: readLocationName(value.end, '도착지'),
    coordinates: parseLegCoordinates(value),
  }
}

function parseFare(value: unknown): number | null {
  if (!isRecord(value) || !isRecord(value.regular)) return null
  return readNonNegativeNumber(value.regular.totalFare)
}

function parseItinerary(value: unknown, index: number): TransitItinerary | null {
  if (!isRecord(value) || !Array.isArray(value.legs)) return null
  const totalDurationSeconds = readNonNegativeNumber(value.totalTime)
  const totalWalkDurationSeconds = readNonNegativeNumber(value.totalWalkTime)
  const totalWalkDistanceM = readNonNegativeNumber(value.totalWalkDistance)
  const totalDistanceM = readNonNegativeNumber(value.totalDistance)
  const transferCount = readNonNegativeNumber(value.transferCount)
  const legs = value.legs
    .map(parseLeg)
    .filter((leg): leg is TransitRouteLeg => leg !== null)

  if (
    totalDurationSeconds === null ||
    totalDurationSeconds <= 0 ||
    totalWalkDurationSeconds === null ||
    totalWalkDistanceM === null ||
    totalDistanceM === null ||
    transferCount === null ||
    legs.length === 0
  ) {
    return null
  }

  return {
    id: `tmap-itinerary-${index + 1}`,
    totalDurationSeconds,
    totalWalkDurationSeconds,
    totalWalkDistanceM,
    totalDistanceM,
    transferCount,
    fareKrw: parseFare(value.fare),
    legs,
  }
}

export function parseTmapTransitRouteResponse(
  value: unknown,
  requestedAt: Date = new Date(),
): TransitRouteResult {
  if (!isRecord(value)) {
    throw new TransitRouteError(
      'INVALID_RESPONSE',
      'TMAP 대중교통 응답 형식이 올바르지 않습니다.',
    )
  }
  if (isRecord(value.result)) {
    throw new TransitRouteError(
      'ROUTE_NOT_FOUND',
      typeof value.result.message === 'string'
        ? value.result.message
        : '대중교통 경로를 찾지 못했습니다.',
    )
  }
  const metaData = value.metaData
  const plan = isRecord(metaData) ? metaData.plan : null
  const rawItineraries = isRecord(plan) ? plan.itineraries : null
  if (!Array.isArray(rawItineraries)) {
    throw new TransitRouteError(
      'INVALID_RESPONSE',
      'TMAP 대중교통 경로 목록이 없습니다.',
    )
  }
  const itineraries = rawItineraries
    .map(parseItinerary)
    .filter((item): item is TransitItinerary => item !== null)
  if (itineraries.length === 0) {
    throw new TransitRouteError(
      'ROUTE_NOT_FOUND',
      '대중교통 경로를 찾지 못했습니다.',
    )
  }
  return {
    itineraries,
    provider: 'tmap-transit',
    requestedAt: requestedAt.toISOString(),
  }
}
