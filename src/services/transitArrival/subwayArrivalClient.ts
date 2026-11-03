import {
  SubwayArrivalError,
  type SubwayArrivalErrorCode,
  type SubwayArrivalInfo,
  type SubwayArrivalRequest,
} from '../../domain/subwayArrival'
import type { TransitRouteLeg } from '../../domain/transitRoute'
import { getSupabaseAccessToken } from '../routing/walkingRouteClient'
import { getTmapSubwayTrainType } from './seoulSubwayMatcher'

const CLIENT_CACHE_TTL_MS = 30_000

interface SubwayArrivalClientDependencies {
  fetch: typeof fetch
  getAccessToken: () => Promise<string | null>
  now?: () => number
}

interface CachedArrival {
  expiresAt: number
  value: SubwayArrivalInfo
}

function adjustArrivalForDisplay(
  value: SubwayArrivalInfo,
  displayedAt: number,
): SubwayArrivalInfo {
  if (value.status !== 'available') return value
  return {
    ...value,
    estimates: value.estimates.map((estimate) => {
      const generatedAt = new Date(estimate.generatedAt).getTime()
      const dataAgeSeconds = Number.isFinite(generatedAt)
        ? Math.max(0, Math.floor((displayedAt - generatedAt) / 1_000))
        : estimate.dataAgeSeconds
      return {
        ...estimate,
        dataAgeSeconds,
        arrivalSeconds: Math.max(
          0,
          estimate.rawArrivalSeconds - dataAgeSeconds,
        ),
      }
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSubwayArrivalInfo(value: unknown): value is SubwayArrivalInfo {
  return isRecord(value) &&
    typeof value.lineName === 'string' &&
    typeof value.stationName === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.estimates) &&
    typeof value.fetchedAt === 'string' &&
    value.provider === 'seoul-subway' &&
    value.dataMode === 'live'
}

function readErrorCode(value: unknown): SubwayArrivalErrorCode {
  if (!isRecord(value) || typeof value.code !== 'string') return 'NETWORK_ERROR'
  const codes: SubwayArrivalErrorCode[] = [
    'AUTH_HEADER_MISSING',
    'AUTH_TOKEN_INVALID',
    'SERVER_AUTH_NOT_CONFIGURED',
    'SERVER_NOT_CONFIGURED',
    'USER_NOT_ALLOWED',
    'PRODUCTION_DISABLED',
    'INVALID_REQUEST',
    'REQUEST_IN_PROGRESS',
    'SEOUL_SUBWAY_API_ERROR',
    'QUOTA_EXCEEDED',
    'REQUEST_TIMEOUT',
    'NETWORK_ERROR',
    'INVALID_RESPONSE',
  ]
  return codes.includes(value.code as SubwayArrivalErrorCode)
    ? value.code as SubwayArrivalErrorCode
    : 'NETWORK_ERROR'
}

export function createSubwayArrivalRequest(
  leg: TransitRouteLeg,
): SubwayArrivalRequest {
  const boardingStation = leg.stops?.[0]
  const nextStation = leg.stops?.[1]
  const alightingStation = leg.stops?.at(-1)
  if (
    leg.mode !== 'SUBWAY' ||
    leg.routeType === null ||
    boardingStation === undefined ||
    nextStation === undefined ||
    alightingStation === undefined ||
    boardingStation === alightingStation
  ) {
    throw new SubwayArrivalError(
      'INVALID_REQUEST',
      'TMAP 지하철 노선 또는 승차·다음·하차역 정보가 없습니다.',
    )
  }
  return {
    routeName: leg.routeName,
    routeType: leg.routeType,
    trainType: getTmapSubwayTrainType(leg.routeType, leg.routeName),
    boardingStation: {
      tmapStationId: boardingStation.providerStopId,
      name: boardingStation.name,
    },
    nextStation: {
      tmapStationId: nextStation.providerStopId,
      name: nextStation.name,
    },
    alightingStation: {
      tmapStationId: alightingStation.providerStopId,
      name: alightingStation.name,
    },
  }
}

export function createSubwayArrivalClient(
  dependencies: SubwayArrivalClientDependencies,
) {
  const cache = new Map<string, CachedArrival>()
  const now = dependencies.now ?? Date.now

  return {
    async getSubwayArrival(
      request: SubwayArrivalRequest,
    ): Promise<SubwayArrivalInfo> {
      const key = JSON.stringify([
        request.routeType,
        request.trainType,
        request.boardingStation.name,
        request.nextStation.name,
        request.alightingStation.name,
      ])
      const currentTime = now()
      const cached = cache.get(key)
      if (cached !== undefined && cached.expiresAt > currentTime) {
        return adjustArrivalForDisplay(cached.value, currentTime)
      }

      const accessToken = await dependencies.getAccessToken()
      if (accessToken === null) {
        throw new SubwayArrivalError(
          'AUTH_SESSION_MISSING',
          '현재 브라우저에 저장된 로그인 세션이 없습니다.',
        )
      }

      let response: Response
      try {
        response = await dependencies.fetch('/api/subway/arrival', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        })
      } catch {
        throw new SubwayArrivalError(
          'NETWORK_ERROR',
          '서울시 지하철 서버에 연결하지 못했습니다.',
        )
      }

      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = isRecord(body) && typeof body.message === 'string'
          ? body.message
          : '지하철 도착정보를 불러오지 못했습니다.'
        throw new SubwayArrivalError(readErrorCode(body), message)
      }
      if (!isSubwayArrivalInfo(body)) {
        throw new SubwayArrivalError(
          'INVALID_RESPONSE',
          '지하철 도착정보 서버 응답이 올바르지 않습니다.',
        )
      }
      const fetchedAt = new Date(body.fetchedAt).getTime()
      const expiresAt = Number.isFinite(fetchedAt)
        ? fetchedAt + CLIENT_CACHE_TTL_MS
        : currentTime + CLIENT_CACHE_TTL_MS
      if (expiresAt > currentTime) {
        cache.set(key, { value: body, expiresAt })
      }
      return adjustArrivalForDisplay(body, currentTime)
    },
  }
}

export const subwayArrivalClient = createSubwayArrivalClient({
  fetch: window.fetch.bind(window),
  getAccessToken: getSupabaseAccessToken,
})
