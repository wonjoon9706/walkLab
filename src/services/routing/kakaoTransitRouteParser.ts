import type {
  KakaoTransitFare,
  KakaoTransitMode,
  KakaoTransitRejectedRoute,
  KakaoTransitRoute,
  KakaoTransitRouteResult,
  KakaoTransitRouteType,
  KakaoTransitStep,
  KakaoTransitStopEvidence,
  KakaoTransitVehicleEvidence,
} from '../../domain/kakaoTransitRoute.js'
import { KakaoTransitResponseError } from '../../domain/kakaoTransitRoute.js'
import type { GeoCoordinate } from '../../domain/walkingRoute.js'

const STEP_MODES = new Set<KakaoTransitMode>([
  'BUS',
  'SUBWAY',
  'WALKING',
])

const ROUTE_TYPES = new Set<KakaoTransitRouteType>([
  'BUS',
  'SUBWAY',
  'BUS_AND_SUBWAY',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' &&
    Number.isInteger(parsed) &&
    parsed >= 0
    ? parsed
    : null
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function parseCoordinate(value: unknown): GeoCoordinate | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const longitude = typeof value[0] === 'string' ? Number(value[0]) : value[0]
  const latitude = typeof value[1] === 'string' ? Number(value[1]) : value[1]
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null
  }
  return { latitude, longitude }
}

function parseCoordinates(value: unknown): GeoCoordinate[] {
  if (!isRecord(value) || !Array.isArray(value.points)) return []
  const coordinates: GeoCoordinate[] = []
  for (const point of value.points) {
    const coordinate = parseCoordinate(point)
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

function parseStops(value: unknown): KakaoTransitStopEvidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((stop, index): KakaoTransitStopEvidence[] => {
    if (!isRecord(stop)) return []
    const name = readText(stop.name)
    return name === null ? [] : [{ index, name }]
  })
}

function parseVehicles(value: unknown): KakaoTransitVehicleEvidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((vehicle, index): KakaoTransitVehicleEvidence[] => {
    if (!isRecord(vehicle)) return []
    const name = readText(vehicle.name)
    if (name === null) return []
    return [{ index, name, type: readText(vehicle.type) }]
  })
}

function parseStep(value: unknown, index: number): KakaoTransitStep | null {
  if (!isRecord(value) || !isRecord(value.properties)) return null
  const properties = value.properties
  const mode = properties.type
  const distanceM = readNonNegativeInteger(properties.distance)
  const durationSeconds = readNonNegativeInteger(properties.time)
  if (
    !STEP_MODES.has(mode as KakaoTransitMode) ||
    distanceM === null ||
    durationSeconds === null
  ) {
    return null
  }
  return {
    index,
    mode: mode as KakaoTransitMode,
    guidance: readText(properties.guidance) ?? '',
    distanceM,
    durationSeconds,
    stops: parseStops(properties.stops),
    vehicles: parseVehicles(properties.vehicles),
    coordinates: parseCoordinates(value.path),
  }
}

function parseFare(value: unknown): KakaoTransitFare | null {
  if (!isRecord(value)) return null
  const fare = {
    value: readNonNegativeInteger(value.value),
    min: readNonNegativeInteger(value.min),
    max: readNonNegativeInteger(value.max),
  }
  return fare.value === null && fare.min === null && fare.max === null
    ? null
    : fare
}

function parseRoute(
  value: unknown,
  routeIndex: number,
): KakaoTransitRoute | KakaoTransitRejectedRoute {
  if (!isRecord(value) || !isRecord(value.properties)) {
    return { routeIndex, reason: 'INVALID_ROUTE_PROPERTIES' }
  }
  const properties = value.properties
  const type = properties.type
  const totalDistanceM = readNonNegativeInteger(properties.totalDistance)
  const totalDurationSeconds = readNonNegativeInteger(properties.totalTime)
  const transferCount = readNonNegativeInteger(properties.transfers)
  if (
    !ROUTE_TYPES.has(type as KakaoTransitRouteType) ||
    totalDistanceM === null ||
    totalDurationSeconds === null ||
    totalDurationSeconds === 0 ||
    transferCount === null ||
    !Array.isArray(value.steps)
  ) {
    return { routeIndex, reason: 'INVALID_ROUTE_PROPERTIES' }
  }
  const steps = value.steps.flatMap((step, stepIndex): KakaoTransitStep[] => {
    const parsed = parseStep(step, stepIndex)
    return parsed === null ? [] : [parsed]
  })
  if (steps.length === 0) {
    return { routeIndex, reason: 'NO_VALID_STEPS' }
  }
  return {
    id: `kakao-publictraffic-route-${routeIndex + 1}`,
    type: type as KakaoTransitRouteType,
    totalDistanceM,
    totalDurationSeconds,
    transferCount,
    fare: parseFare(properties.fare),
    steps,
  }
}

function readReportedCounts(value: unknown) {
  if (!isRecord(value)) return null
  const total = readNonNegativeInteger(value.total)
  const bus = readNonNegativeInteger(value.bus)
  const subway = readNonNegativeInteger(value.subway)
  const busAndSubway = readNonNegativeInteger(value.busAndSubway)
  if (total === null || bus === null || subway === null || busAndSubway === null) {
    return null
  }
  return { total, bus, subway, busAndSubway }
}

export function parseKakaoTransitRouteResponse(
  value: unknown,
  requestedAt: Date = new Date(),
): KakaoTransitRouteResult {
  if (!isRecord(value) || typeof value.status !== 'string') {
    throw new KakaoTransitResponseError(
      'INVALID_RESPONSE',
      '카카오 대중교통 응답 형식이 올바르지 않습니다.',
    )
  }
  if (value.status !== 'OK') {
    throw new KakaoTransitResponseError(
      value.status === 'NO_RESULTS' ? 'ROUTE_NOT_FOUND' : 'INVALID_RESPONSE',
      `카카오 대중교통 경로를 사용할 수 없습니다: ${value.status}`,
    )
  }
  const reportedRouteCounts = readReportedCounts(value.properties)
  if (
    reportedRouteCounts === null ||
    !Array.isArray(value.routes) ||
    Number.isNaN(requestedAt.getTime())
  ) {
    throw new KakaoTransitResponseError(
      'INVALID_RESPONSE',
      '카카오 대중교통 경로 목록이 올바르지 않습니다.',
    )
  }

  const routes: KakaoTransitRoute[] = []
  const rejectedRoutes: KakaoTransitRejectedRoute[] = []
  value.routes.forEach((route, routeIndex) => {
    const parsed = parseRoute(route, routeIndex)
    if ('reason' in parsed) rejectedRoutes.push(parsed)
    else routes.push(parsed)
  })
  if (routes.length === 0) {
    throw new KakaoTransitResponseError(
      'ROUTE_NOT_FOUND',
      '파싱 가능한 카카오 대중교통 경로가 없습니다.',
    )
  }
  return {
    provider: 'kakao-map-publictraffic',
    requestedAt: requestedAt.toISOString(),
    reportedRouteCounts,
    routes,
    rejectedRoutes,
  }
}
