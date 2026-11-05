import type { SeoulBusProvider } from '../../../server/tago/seoulBusProvider'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import { getSupabaseAccessToken } from './walkingRouteClient'

interface Dependencies {
  fetch: typeof fetch
  getAccessToken(): Promise<string | null>
  now?: () => number
}

const ROUTE_ARRIVAL_CACHE_TTL_MS = 30_000

export class SeoulBusEvidenceError extends Error {
  constructor(public readonly code: string, public readonly status: number | null,
    public readonly requestId: string | null = null) {
    super(code)
    this.name = 'SeoulBusEvidenceError'
  }
}

export function createSeoulBusEvidenceClient(
  dependencies: Dependencies,
): SeoulBusProvider {
  const now = dependencies.now ?? Date.now
  const routeArrivalCache = new Map<string, {
    expiresAt: number
    value: Awaited<ReturnType<SeoulBusProvider['getRouteArrivals']>>
  }>()
  const routeArrivalInFlight = new Map<string, Promise<Awaited<ReturnType<SeoulBusProvider['getRouteArrivals']>>>>()
  async function request(body: Record<string, unknown>, signal: AbortSignal) {
    const token = await dependencies.getAccessToken()
    if (token === null) throw new Error('AUTH_SESSION_MISSING')
    let response: Response
    try {
      response = await dependencies.fetch('/api/kakao/seoul-bus-evidence', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new Error('NETWORK_ERROR', { cause: error })
    }
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(value)) {
      const code = typeof value === 'object' && value !== null && 'code' in value ? value.code : null
      const allowed = ['PRODUCTION_DISABLED', 'SERVER_NOT_CONFIGURED', 'SERVER_AUTH_NOT_CONFIGURED',
        'AUTH_HEADER_MISSING', 'AUTH_TOKEN_INVALID', 'USER_NOT_ALLOWED', 'REQUEST_TIMEOUT',
        'QUOTA_EXCEEDED', 'INVALID_REQUEST', 'INVALID_RESPONSE', 'NETWORK_ERROR', 'SEOUL_BUS_API_ERROR', 'SEOUL_BUS_AUTH_ERROR',
        'AUTH_REQUEST_TIMEOUT', 'AUTH_SERVICE_UNAVAILABLE']
      const gatewayTimeout = response.headers.get('x-vercel-error') === 'FUNCTION_INVOCATION_TIMEOUT'
        ? 'FUNCTION_INVOCATION_TIMEOUT' : 'GATEWAY_TIMEOUT'
      const errorCode = typeof code === 'string' && allowed.includes(code) ? code
        : response.status === 504 ? gatewayTimeout : 'INVALID_RESPONSE'
      const id = response.headers.get('X-Smart-Arrival-Request-Id')
      throw new SeoulBusEvidenceError(errorCode, response.status,
        id !== null && /^[a-f0-9-]{36}$/i.test(id) ? id : null)
    }
    return value
  }
  return {
    async getNearbyStops(coordinate: GeoCoordinate, signal: AbortSignal) {
      return await request({ operation: 'nearby_stops', coordinate }, signal) as Awaited<ReturnType<SeoulBusProvider['getNearbyStops']>>
    },
    async getRoutesAtStop(arsId: string, signal: AbortSignal) {
      return await request({ operation: 'routes_at_stop', arsId }, signal) as Awaited<ReturnType<SeoulBusProvider['getRoutesAtStop']>>
    },
    async getRouteArrivals(routeId: string, signal: AbortSignal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const currentTime = now()
      const cached = routeArrivalCache.get(routeId)
      if (cached !== undefined && cached.expiresAt > currentTime) {
        return cached.value
      }
      const pending = routeArrivalInFlight.get(routeId)
      if (pending !== undefined) return pending
      const load = (async () => {
        const stops = await request({ operation: 'route_arrivals', routeId }, signal) as Awaited<ReturnType<SeoulBusProvider['getRouteArrivals']>>
        const fetchedAt = new Date(now()).toISOString()
        const value = stops.map((stop) => ({ ...stop, fetchedAt }))
        routeArrivalCache.set(routeId, { expiresAt: now() + ROUTE_ARRIVAL_CACHE_TTL_MS, value })
        return value
      })()
      routeArrivalInFlight.set(routeId, load)
      try { return await load }
      finally { if (routeArrivalInFlight.get(routeId) === load) routeArrivalInFlight.delete(routeId) }
    },
  }
}

export const seoulBusEvidenceClient = createSeoulBusEvidenceClient({
  fetch: window.fetch.bind(window),
  getAccessToken: getSupabaseAccessToken,
})
