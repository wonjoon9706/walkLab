import { describe, expect, it, vi } from 'vitest'
import { createSeoulBusEvidenceClient } from './seoulBusEvidenceClient'

describe('seoulBusEvidenceClient', () => {
  it.each(['SERVER_NOT_CONFIGURED', 'REQUEST_TIMEOUT', 'QUOTA_EXCEEDED', 'INVALID_RESPONSE',
    'SEOUL_BUS_AUTH_ERROR', 'NETWORK_ERROR'])('서버 오류 %s를 정류장 후보 없음과 구분한다', async (code) => {
    const client = createSeoulBusEvidenceClient({ getAccessToken: async () => 'test-token',
      fetch: vi.fn(async () => new Response(JSON.stringify({ code }), { status: 502 })) })
    await expect(client.getNearbyStops({ latitude: 37, longitude: 127 }, new AbortController().signal))
      .rejects.toThrow(code)
  })
  it('같은 노선 경유·도착 응답을 30초 동안 재사용한다', async () => {
    let now = 1_000
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), {
      status: 200,
    }))
    const client = createSeoulBusEvidenceClient({
      fetch: fetchMock,
      getAccessToken: async () => 'test-token',
      now: () => now,
    })
    const signal = new AbortController().signal

    await client.getRouteArrivals('route-17', signal)
    await client.getRouteArrivals('route-17', signal)
    expect(fetchMock).toHaveBeenCalledOnce()

    now += 30_001
    await client.getRouteArrivals('route-17', signal)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
