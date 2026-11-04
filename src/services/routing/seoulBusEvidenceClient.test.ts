import { describe, expect, it, vi } from 'vitest'
import { createSeoulBusEvidenceClient } from './seoulBusEvidenceClient'

describe('seoulBusEvidenceClient', () => {
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
