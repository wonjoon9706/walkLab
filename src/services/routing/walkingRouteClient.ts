import type {
  GeoCoordinate,
  WalkingRoute,
  WalkingRouteErrorCode,
} from '../../domain/walkingRoute'
import { WalkingRouteError } from '../../domain/walkingRoute'
import { supabaseClient } from '../../repositories/remote/supabaseClient'

interface WalkingRouteRequest {
  start: GeoCoordinate
  destination: GeoCoordinate
}

interface WalkingRouteClientDependencies {
  fetch: typeof fetch
  getAccessToken: () => Promise<string | null>
}

export async function getSupabaseAccessToken(
  client = supabaseClient,
  now: Date = new Date(),
): Promise<string | null> {
  if (client === null) return null
  const { data, error } = await client.auth.getSession()
  if (error !== null) throw error
  const session = data.session
  if (session === null) return null

  const expiresAtMs = (session.expires_at ?? 0) * 1000
  if (expiresAtMs > now.getTime() + 60_000) {
    return session.access_token
  }

  const { data: refreshedData, error: refreshError } =
    await client.auth.refreshSession()
  if (refreshError !== null) throw refreshError
  return refreshedData.session?.access_token ?? null
}

function isWalkingRoute(value: unknown): value is WalkingRoute {
  if (typeof value !== 'object' || value === null) return false
  const route = value as Partial<WalkingRoute>
  return (
    route.provider === 'kakao-walking-route' &&
    typeof route.distanceM === 'number' &&
    typeof route.providerDurationSeconds === 'number' &&
    typeof route.requestedAt === 'string' &&
    Array.isArray(route.coordinates) &&
    route.coordinates.length >= 2 &&
    route.coordinates.every((coordinate) => {
      if (typeof coordinate !== 'object' || coordinate === null) return false
      const item = coordinate as Partial<GeoCoordinate>
      return (
        typeof item.latitude === 'number' &&
        Number.isFinite(item.latitude) &&
        item.latitude >= -90 &&
        item.latitude <= 90 &&
        typeof item.longitude === 'number' &&
        Number.isFinite(item.longitude) &&
        item.longitude >= -180 &&
        item.longitude <= 180
      )
    })
  )
}

function toErrorCode(value: unknown): WalkingRouteErrorCode {
  if (typeof value !== 'object' || value === null) return 'NETWORK_ERROR'
  const code = (value as { code?: unknown }).code
  switch (code) {
    case 'AUTH_SESSION_MISSING':
    case 'AUTH_HEADER_MISSING':
    case 'AUTH_TOKEN_INVALID':
    case 'SERVER_AUTH_NOT_CONFIGURED':
    case 'INVALID_REQUEST':
    case 'POINTS_TOO_CLOSE':
    case 'ROUTE_NOT_FOUND':
    case 'KAKAO_AUTH_ERROR':
    case 'QUOTA_EXCEEDED':
    case 'REQUEST_TIMEOUT':
    case 'NETWORK_ERROR':
    case 'INVALID_RESPONSE':
    case 'SERVER_NOT_CONFIGURED':
      return code
    default:
      return 'NETWORK_ERROR'
  }
}

export function createWalkingRouteClient(
  dependencies: WalkingRouteClientDependencies,
) {
  return {
    async getWalkingRoute(request: WalkingRouteRequest): Promise<WalkingRoute> {
      const accessToken = await dependencies.getAccessToken()
      if (accessToken === null) {
        throw new WalkingRouteError(
          'AUTH_SESSION_MISSING',
          '현재 주소에 저장된 로그인 세션이 없습니다.',
        )
      }

      const query = new URLSearchParams({
        start_x: request.start.longitude.toString(),
        start_y: request.start.latitude.toString(),
        end_x: request.destination.longitude.toString(),
        end_y: request.destination.latitude.toString(),
      })

      let response: Response
      try {
        response = await dependencies.fetch(
          `/api/kakao/walking-route?${query.toString()}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        )
      } catch {
        throw new WalkingRouteError(
          'NETWORK_ERROR',
          '도보 경로 서버에 연결하지 못했습니다.',
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
            : '도보 경로를 불러오지 못했습니다.'
        throw new WalkingRouteError(
          code,
          message,
        )
      }

      if (!isWalkingRoute(body)) {
        throw new WalkingRouteError(
          'INVALID_RESPONSE',
          '도보 경로 서버 응답이 올바르지 않습니다.',
        )
      }
      return body
    },
  }
}

export const walkingRouteClient = createWalkingRouteClient({
  fetch: window.fetch.bind(window),
  getAccessToken: getSupabaseAccessToken,
})
