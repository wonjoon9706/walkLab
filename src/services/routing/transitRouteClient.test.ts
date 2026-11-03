import { describe, expect, it, vi } from 'vitest'
import { TransitRouteError } from '../../domain/transitRoute'
import { createTransitRouteClient } from './transitRouteClient'

const result = {
  provider: 'tmap-transit',
  requestedAt: '2026-11-02T00:00:00.000Z',
  itineraries: [{
    id: 'route-1',
    totalDurationSeconds: 900,
    totalWalkDurationSeconds: 200,
    totalWalkDistanceM: 250,
    totalDistanceM: 4000,
    transferCount: 0,
    fareKrw: 1500,
    legs: [{
      mode: 'BUS',
      distanceM: 3750,
      durationSeconds: 700,
      routeName: '100',
      routeColor: null,
      startName: 'A',
      endName: 'B',
      coordinates: [{ latitude: 37.5, longitude: 127.1 }],
    }],
  }],
}

describe('대중교통 경로 클라이언트', () => {
  it('로그인 토큰과 좌표를 POST 본문으로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), { status: 200 }),
    )
    const client = createTransitRouteClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
    })
    const request = {
      start: { latitude: 37.5, longitude: 127.1 },
      destination: { latitude: 37.6, longitude: 127.2 },
    }

    await expect(client.getTransitRoutes(request)).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('/api/tmap/transit-routes', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })
  })

  it('로그인 세션이 없으면 서버를 호출하지 않는다', async () => {
    const fetchMock = vi.fn()
    const client = createTransitRouteClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue(null),
    })

    await expect(client.getTransitRoutes({
      start: { latitude: 37.5, longitude: 127.1 },
      destination: { latitude: 37.6, longitude: 127.2 },
    })).rejects.toMatchObject<Partial<TransitRouteError>>({
      code: 'AUTH_SESSION_MISSING',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
