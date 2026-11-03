import type {
  TransitRouteErrorCode,
  TransitRouteResult,
} from '../../domain/transitRoute'
import { TransitRouteError } from '../../domain/transitRoute'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import { getSupabaseAccessToken } from './walkingRouteClient'

interface TransitRouteRequest {
  start: GeoCoordinate
  destination: GeoCoordinate
}

interface TransitRouteClientDependencies {
  fetch: typeof fetch
  getAccessToken: () => Promise<string | null>
}

function isCoordinate(value: unknown): value is GeoCoordinate {
  if (typeof value !== 'object' || value === null) return false
  const coordinate = value as Partial<GeoCoordinate>
  return (
    typeof coordinate.latitude === 'number' &&
    Number.isFinite(coordinate.latitude) &&
    typeof coordinate.longitude === 'number' &&
    Number.isFinite(coordinate.longitude)
  )
}

function isTransitRouteResult(value: unknown): value is TransitRouteResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Partial<TransitRouteResult>
  return (
    result.provider === 'tmap-transit' &&
    typeof result.requestedAt === 'string' &&
    Array.isArray(result.itineraries) &&
    result.itineraries.length > 0 &&
    result.itineraries.every((itinerary) =>
      typeof itinerary === 'object' &&
      itinerary !== null &&
      typeof itinerary.id === 'string' &&
      typeof itinerary.totalDurationSeconds === 'number' &&
      Array.isArray(itinerary.legs) &&
      itinerary.legs.every((leg) =>
        typeof leg === 'object' &&
        leg !== null &&
        typeof leg.mode === 'string' &&
        Array.isArray(leg.coordinates) &&
        leg.coordinates.every(isCoordinate),
      ),
    )
  )
}

function toErrorCode(value: unknown): TransitRouteErrorCode {
  if (typeof value !== 'object' || value === null) return 'NETWORK_ERROR'
  const code = (value as { code?: unknown }).code
  switch (code) {
    case 'AUTH_SESSION_MISSING':
    case 'AUTH_HEADER_MISSING':
    case 'AUTH_TOKEN_INVALID':
    case 'SERVER_AUTH_NOT_CONFIGURED':
    case 'SERVER_NOT_CONFIGURED':
    case 'USER_NOT_ALLOWED':
    case 'PRODUCTION_DISABLED':
    case 'INVALID_REQUEST':
    case 'ROUTE_NOT_FOUND':
    case 'TMAP_AUTH_ERROR':
    case 'QUOTA_EXCEEDED':
    case 'REQUEST_TIMEOUT':
    case 'NETWORK_ERROR':
    case 'INVALID_RESPONSE':
      return code
    default:
      return 'NETWORK_ERROR'
  }
}

export function createTransitRouteClient(
  dependencies: TransitRouteClientDependencies,
) {
  return {
    async getTransitRoutes(
      request: TransitRouteRequest,
    ): Promise<TransitRouteResult> {
      const accessToken = await dependencies.getAccessToken()
      if (accessToken === null) {
        throw new TransitRouteError(
          'AUTH_SESSION_MISSING',
          '현재 주소에 저장된 로그인 세션이 없습니다.',
        )
      }

      let response: Response
      try {
        response = await dependencies.fetch('/api/tmap/transit-routes', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        })
      } catch {
        throw new TransitRouteError(
          'NETWORK_ERROR',
          '대중교통 경로 서버에 연결하지 못했습니다.',
        )
      }

      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const code = toErrorCode(body)
        const message =
          typeof body === 'object' &&
          body !== null &&
          typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : '대중교통 경로를 불러오지 못했습니다.'
        throw new TransitRouteError(code, message)
      }
      if (!isTransitRouteResult(body)) {
        throw new TransitRouteError(
          'INVALID_RESPONSE',
          '대중교통 경로 서버 응답이 올바르지 않습니다.',
        )
      }
      return body
    },
  }
}

export const transitRouteClient = createTransitRouteClient({
  fetch: window.fetch.bind(window),
  getAccessToken: getSupabaseAccessToken,
})
