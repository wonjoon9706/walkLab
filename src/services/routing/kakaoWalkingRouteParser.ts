import type {
  GeoCoordinate,
  WalkingRoute,
} from '../../domain/walkingRoute.js'
import { WalkingRouteError } from '../../domain/walkingRoute.js'

interface KakaoWalkingRouteResponse {
  status?: unknown
  route?: {
    properties?: {
      totalDistance?: unknown
      totalTime?: unknown
    }
    legs?: unknown
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseCoordinate(value: unknown): GeoCoordinate | null {
  if (!Array.isArray(value) || value.length < 2) return null

  const [longitude, latitude] = value
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  return { latitude, longitude }
}

function parsePathCoordinates(legs: unknown): GeoCoordinate[] {
  if (!Array.isArray(legs)) return []

  const coordinates: GeoCoordinate[] = []
  for (const leg of legs) {
    if (!isRecord(leg) || !Array.isArray(leg.steps)) continue

    for (const step of leg.steps) {
      if (!isRecord(step) || !isRecord(step.path)) continue
      const points = step.path.points
      if (!Array.isArray(points)) continue

      for (const point of points) {
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
    }
  }
  return coordinates
}

function mapProviderStatus(status: string): WalkingRouteError {
  if (status === 'SAME_POINT') {
    return new WalkingRouteError(
      'POINTS_TOO_CLOSE',
      '출발지와 목적지가 너무 가깝습니다.',
    )
  }
  return new WalkingRouteError(
    'ROUTE_NOT_FOUND',
    `도보 경로를 찾지 못했습니다. (${status})`,
  )
}

export function parseKakaoWalkingRouteResponse(
  value: unknown,
  requestedAt: Date = new Date(),
): WalkingRoute {
  if (!isRecord(value)) {
    throw new WalkingRouteError(
      'INVALID_RESPONSE',
      '카카오 경로 응답 형식이 올바르지 않습니다.',
    )
  }

  const response = value as KakaoWalkingRouteResponse
  if (typeof response.status !== 'string') {
    throw new WalkingRouteError(
      'INVALID_RESPONSE',
      '카카오 경로 상태값이 없습니다.',
    )
  }
  if (response.status !== 'OK') {
    throw mapProviderStatus(response.status)
  }

  const distanceM = response.route?.properties?.totalDistance
  const providerDurationSeconds = response.route?.properties?.totalTime
  const coordinates = parsePathCoordinates(response.route?.legs)

  if (
    typeof distanceM !== 'number' ||
    !Number.isFinite(distanceM) ||
    distanceM <= 0 ||
    typeof providerDurationSeconds !== 'number' ||
    !Number.isFinite(providerDurationSeconds) ||
    providerDurationSeconds <= 0 ||
    coordinates.length < 2
  ) {
    throw new WalkingRouteError(
      'INVALID_RESPONSE',
      '카카오 경로 응답에 유효한 거리·시간·좌표가 없습니다.',
    )
  }

  return {
    distanceM,
    providerDurationSeconds,
    coordinates,
    provider: 'kakao-walking-route',
    requestedAt: requestedAt.toISOString(),
  }
}
