import {
  BusArrivalError,
  type BusArrivalErrorCode,
  type BusArrivalInfo,
  type BusArrivalRequest,
} from '../../domain/busArrival'
import type { TransitRouteLeg } from '../../domain/transitRoute'
import { getSupabaseAccessToken } from '../routing/walkingRouteClient'

const CLIENT_CACHE_TTL_MS = 30_000

interface BusArrivalClientDependencies {
  fetch: typeof fetch
  getAccessToken: () => Promise<string | null>
  now?: () => number
}

interface CachedArrival {
  expiresAt: number
  value: BusArrivalInfo
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBusArrivalInfo(value: unknown): value is BusArrivalInfo {
  if (!isRecord(value)) return false
  const common =
    typeof value.routeName === 'string' &&
    typeof value.stopName === 'string' &&
    typeof value.fetchedAt === 'string' &&
    (value.provider === 'tago' || value.provider === 'seoul') &&
    value.dataMode === 'live' &&
    (value.walkingTimeToStopSeconds === null ||
      typeof value.walkingTimeToStopSeconds === 'number')
  if (!common || typeof value.status !== 'string') return false
  if (value.status === 'available') {
    return typeof value.stopId === 'string' &&
      typeof value.arrivalSeconds === 'number' &&
      Number.isFinite(value.arrivalSeconds) &&
      value.arrivalSeconds >= 0 &&
      (value.remainingStops === null || (
        typeof value.remainingStops === 'number' &&
        Number.isInteger(value.remainingStops) &&
        value.remainingStops >= 0
      ))
  }
  return [
    'no_service',
    'unsupported_region',
    'stop_match_failed',
    'stop_match_review_required',
    'api_error',
  ].includes(value.status) &&
    (value.stopId === null || typeof value.stopId === 'string') &&
    value.arrivalSeconds === null &&
    value.remainingStops === null
}

function readErrorCode(value: unknown): BusArrivalErrorCode {
  if (!isRecord(value) || typeof value.code !== 'string') return 'NETWORK_ERROR'
  const codes: BusArrivalErrorCode[] = [
    'AUTH_HEADER_MISSING',
    'AUTH_TOKEN_INVALID',
    'SERVER_AUTH_NOT_CONFIGURED',
    'SERVER_NOT_CONFIGURED',
    'USER_NOT_ALLOWED',
    'PRODUCTION_DISABLED',
    'INVALID_REQUEST',
    'REQUEST_IN_PROGRESS',
    'TAGO_AUTH_ERROR',
    'SEOUL_BUS_API_ERROR',
    'QUOTA_EXCEEDED',
    'REQUEST_TIMEOUT',
    'NETWORK_ERROR',
    'INVALID_RESPONSE',
  ]
  return codes.includes(value.code as BusArrivalErrorCode)
    ? value.code as BusArrivalErrorCode
    : 'NETWORK_ERROR'
}

export function createBusArrivalRequest(
  leg: TransitRouteLeg,
): BusArrivalRequest {
  const boardingStop = leg.stops?.[0]
  const alightingStop = leg.stops?.at(-1)
  if (
    leg.mode !== 'BUS' ||
    leg.routeName === null ||
    boardingStop === undefined ||
    alightingStop === undefined ||
    boardingStop === alightingStop
  ) {
    throw new BusArrivalError(
      'INVALID_REQUEST',
      '경로 버스 노선 또는 승차 정류장 정보가 없습니다.',
    )
  }
  const nextStop = leg.stops?.[1]
  return {
    routeName: leg.routeName,
    routeId: leg.routeId ?? null,
    boardingStop: {
      providerStopId: boardingStop.providerStopId,
      name: boardingStop.name,
      coordinate: boardingStop.coordinate,
    },
    nextStop: nextStop === undefined
      ? null
      : {
          providerStopId: nextStop.providerStopId,
          name: nextStop.name,
          coordinate: nextStop.coordinate,
        },
    alightingStop: {
      providerStopId: alightingStop.providerStopId,
      name: alightingStop.name,
      coordinate: alightingStop.coordinate,
    },
  }
}

export function createBusArrivalClient(
  dependencies: BusArrivalClientDependencies,
) {
  const cache = new Map<string, CachedArrival>()
  const now = dependencies.now ?? Date.now

  return {
    async getBusArrival(request: BusArrivalRequest): Promise<BusArrivalInfo> {
      const key = JSON.stringify([
        request.routeName,
        request.boardingStop.coordinate.latitude,
        request.boardingStop.coordinate.longitude,
        request.alightingStop.coordinate.latitude,
        request.alightingStop.coordinate.longitude,
      ])
      const currentTime = now()
      const cached = cache.get(key)
      if (cached !== undefined && cached.expiresAt > currentTime) {
        return cached.value
      }

      const accessToken = await dependencies.getAccessToken()
      if (accessToken === null) {
        throw new BusArrivalError(
          'AUTH_SESSION_MISSING',
          '현재 브라우저에 저장된 로그인 세션이 없습니다.',
        )
      }

      let response: Response
      try {
        response = await dependencies.fetch('/api/tago/bus-arrival', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        })
      } catch {
        throw new BusArrivalError('NETWORK_ERROR', 'TAGO 서버에 연결하지 못했습니다.')
      }

      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = isRecord(body) && typeof body.message === 'string'
          ? body.message
          : '버스 도착정보를 불러오지 못했습니다.'
        throw new BusArrivalError(readErrorCode(body), message)
      }
      if (!isBusArrivalInfo(body)) {
        throw new BusArrivalError(
          'INVALID_RESPONSE',
          '버스 도착정보 서버 응답이 올바르지 않습니다.',
        )
      }
      cache.set(key, {
        value: body,
        expiresAt: currentTime + CLIENT_CACHE_TTL_MS,
      })
      return body
    },
  }
}

export const busArrivalClient = createBusArrivalClient({
  fetch: window.fetch.bind(window),
  getAccessToken: getSupabaseAccessToken,
})
