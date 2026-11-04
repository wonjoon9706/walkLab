import type { SeoulBusProvider } from '../../../api/tago/seoulBusProvider'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import { getSupabaseAccessToken } from './walkingRouteClient'

interface Dependencies {
  fetch: typeof fetch
  getAccessToken(): Promise<string | null>
  now?: () => number
}

const ROUTE_ARRIVAL_CACHE_TTL_MS = 30_000

export function createSeoulBusEvidenceClient(
  dependencies: Dependencies,
): SeoulBusProvider {
  const now = dependencies.now ?? Date.now
  const routeArrivalCache = new Map<string, {
    expiresAt: number
    value: Awaited<ReturnType<SeoulBusProvider['getRouteArrivals']>>
  }>()
  async function request(body: Record<string, unknown>, signal: AbortSignal) {
    const token = await dependencies.getAccessToken()
    if (token === null) throw new Error('AUTH_SESSION_MISSING')
    const response = await dependencies.fetch('/api/kakao/seoul-bus-evidence', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(value)) throw new Error('SEOUL_BUS_EVIDENCE_FAILED')
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
      const currentTime = now()
      const cached = routeArrivalCache.get(routeId)
      if (cached !== undefined && cached.expiresAt > currentTime) {
        return cached.value
      }
      const value = await request(
        { operation: 'route_arrivals', routeId },
        signal,
      ) as Awaited<ReturnType<SeoulBusProvider['getRouteArrivals']>>
      routeArrivalCache.set(routeId, {
        expiresAt: currentTime + ROUTE_ARRIVAL_CACHE_TTL_MS,
        value,
      })
      return value
    },
  }
}

export const seoulBusEvidenceClient = createSeoulBusEvidenceClient({
  fetch: window.fetch.bind(window),
  getAccessToken: getSupabaseAccessToken,
})
