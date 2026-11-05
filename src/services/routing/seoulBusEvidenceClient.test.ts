import { describe, expect, it, vi } from 'vitest'
import { createSeoulBusEvidenceClient } from './seoulBusEvidenceClient'

describe('seoulBusEvidenceClient', () => {
  it('Vercel 비JSON 504를 파서 오류로 바꾸지 않는다', async () => {
    const client = createSeoulBusEvidenceClient({ getAccessToken: async () => 'fake',
      fetch: vi.fn(async () => new Response('Gateway Timeout', { status: 504, headers: { 'x-vercel-error': 'FUNCTION_INVOCATION_TIMEOUT' } })) })
    await expect(client.getRouteArrivals('test', new AbortController().signal)).rejects.toThrow('FUNCTION_INVOCATION_TIMEOUT')
  })
  it('진행 중 요청과 원본 수신시각을 공유하고 실패 후 다시 요청할 수 있다', async () => {
    let now = 1_000
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('connection'))
      .mockImplementation(async () => new Response(JSON.stringify([{ routeId: 'test', estimates: [] }])))
    const client = createSeoulBusEvidenceClient({ fetch: fetchMock, getAccessToken: async () => 'fake', now: () => now })
    const signal = new AbortController().signal
    await expect(client.getRouteArrivals('test', signal)).rejects.toThrow('NETWORK_ERROR')
    const [first, second] = await Promise.all([client.getRouteArrivals('test', signal), client.getRouteArrivals('test', signal)])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(first).toBe(second)
    now += 29_000
    expect((await client.getRouteArrivals('test', signal))[0].fetchedAt).toBe(new Date(1_000).toISOString())
  })
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
